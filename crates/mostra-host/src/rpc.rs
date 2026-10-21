//! The JSON-RPC 2.0 peer every connection to an instance uses (D83, INTERFACES §6): one JSON
//! message per line, requests correlated by ID, notifications, the instance's port requests
//! answered on the same connection, and errors carried as diagnostics in `error.data`.
//!
//! One reader task reads lines in order and one writer task writes them in order. A call writes
//! its request when it is made, not when its future is first polled, so calls made one after
//! another reach the instance in that order (the event stream's acknowledgements rely on it).

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot, watch};

use crate::error::{Error, Result};
use crate::wire::Diagnostic;

/// The longest line the protocol allows, in UTF-16 code units (`MAX_LINE_LENGTH`).
pub(crate) const MAX_LINE_LENGTH: usize = 64 * 1024 * 1024;

/// The longest line read, in bytes: every UTF-16 unit is at most three UTF-8 bytes.
const MAX_LINE_BYTES: usize = 3 * MAX_LINE_LENGTH;

/// A boxed future, for handlers stored behind trait objects.
pub(crate) type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// An error answer to an instance's request: the JSON-RPC code and the diagnostic.
#[derive(Debug, Clone)]
pub(crate) struct Failure {
    pub(crate) code: i64,
    pub(crate) diagnostic: Value,
}

impl Failure {
    /// A failure with a cataloged code.
    pub(crate) fn new(rpc_code: i64, code: &str, message: impl Into<String>) -> Self {
        Self {
            code: rpc_code,
            diagnostic: diagnostic(code, &message.into()),
        }
    }
}

/// A diagnostic as this side writes it (INTERFACES §13).
pub(crate) fn diagnostic(code: &str, message: &str) -> Value {
    json!({
        "code": code,
        "severity": "error",
        "message": message,
        "phase": "host",
        "docs": format!("https://mostra-dev.github.io/mostra/errors/{code}"),
    })
}

/// What answers the instance's requests (the host's ports).
pub(crate) trait Incoming: Send + Sync {
    /// Answers one request.
    fn request(&self, method: String, params: Value) -> BoxFuture<'static, Result<Value, Failure>>;
}

type Listener = Box<dyn Fn(&str, &Value) + Send + Sync>;

struct Inner {
    out: mpsc::UnboundedSender<String>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value>>>>,
    next: AtomicU64,
    listeners: Mutex<Vec<(u64, Arc<Listener>)>>,
    closed: watch::Sender<Option<String>>,
}

impl Inner {
    fn close(&self, reason: &str) {
        let first = self.closed.send_if_modified(|current| {
            if current.is_some() {
                return false;
            }
            *current = Some(reason.to_owned());
            true
        });
        if !first {
            return;
        }
        let pending: Vec<_> = self.lock_pending().drain().collect();
        for (_, waiter) in pending {
            let _ = waiter.send(Err(Error::closed(reason.to_owned())));
        }
    }

    fn lock_pending(
        &self,
    ) -> std::sync::MutexGuard<'_, HashMap<u64, oneshot::Sender<Result<Value>>>> {
        self.pending
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

/// One connection's peer.
#[derive(Clone)]
pub(crate) struct Peer {
    inner: Arc<Inner>,
}

impl Peer {
    /// Starts the peer over a reader and a writer, answering requests with `incoming`.
    pub(crate) fn start<R, W>(reader: R, writer: W, incoming: Arc<dyn Incoming>) -> Self
    where
        R: AsyncRead + Unpin + Send + 'static,
        W: AsyncWrite + Unpin + Send + 'static,
    {
        let (out, mut lines) = mpsc::unbounded_channel::<String>();
        let (closed, _) = watch::channel(None);
        let inner = Arc::new(Inner {
            out,
            pending: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            listeners: Mutex::new(Vec::new()),
            closed,
        });
        let writing = Arc::clone(&inner);
        tokio::spawn(async move {
            let mut writer = writer;
            while let Some(line) = lines.recv().await {
                if writer.write_all(line.as_bytes()).await.is_err() || writer.flush().await.is_err()
                {
                    writing
                        .close("The connection to the Mostra instance stopped accepting writes.");
                    break;
                }
            }
            let _ = writer.shutdown().await;
        });
        let reading = Arc::clone(&inner);
        tokio::spawn(async move {
            let mut reader = BufReader::new(reader);
            let mut buffer = Vec::new();
            loop {
                buffer.clear();
                match read_line(&mut reader, &mut buffer).await {
                    Ok(true) => dispatch(&reading, &buffer, &incoming),
                    Ok(false) => {
                        reading.close("The Mostra instance closed the connection.");
                        break;
                    }
                    Err(message) => {
                        reading.close(&message);
                        break;
                    }
                }
            }
        });
        Self { inner }
    }

    /// Sends a request now and returns its answer's future (`timeout`: give up after it).
    pub(crate) fn call(
        &self,
        method: &str,
        params: Value,
        timeout: Option<Duration>,
    ) -> impl Future<Output = Result<Value>> + Send + 'static {
        let id = self.inner.next.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        let early = if self.inner.closed.borrow().is_some() {
            Some(Error::closed(
                "The connection to the Mostra instance is closed.",
            ))
        } else {
            self.inner.lock_pending().insert(id, sender);
            let mut message = serde_json::Map::new();
            message.insert("jsonrpc".into(), Value::from("2.0"));
            message.insert("id".into(), Value::from(id));
            message.insert("method".into(), Value::from(method));
            message.insert("params".into(), params);
            let line = encode(&Value::Object(message));
            match line {
                Ok(line) => {
                    if self.inner.out.send(line).is_err() {
                        self.inner.lock_pending().remove(&id);
                        Some(Error::closed(
                            "The connection to the Mostra instance is closed.",
                        ))
                    } else {
                        None
                    }
                }
                Err(error) => {
                    self.inner.lock_pending().remove(&id);
                    Some(error)
                }
            }
        };
        let inner = Arc::clone(&self.inner);
        let method = method.to_owned();
        async move {
            if let Some(error) = early {
                return Err(error);
            }
            let answer = async {
                receiver.await.unwrap_or_else(|_| {
                    Err(Error::closed(
                        "The connection to the Mostra instance closed.",
                    ))
                })
            };
            match timeout {
                None => answer.await,
                Some(limit) => {
                    if let Ok(result) = tokio::time::timeout(limit, answer).await {
                        result
                    } else {
                        inner.lock_pending().remove(&id);
                        Err(Error::new(
                            "MOSTRA_HOST_TIMEOUT",
                            format!("{method} had no answer within {} ms.", limit.as_millis()),
                        ))
                    }
                }
            }
        }
    }

    /// Calls `listener` with every notification, in order, until the returned guard drops.
    pub(crate) fn listen(&self, listener: Listener) -> ListenGuard {
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let key = NEXT.fetch_add(1, Ordering::Relaxed);
        self.inner
            .listeners
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push((key, Arc::new(listener)));
        ListenGuard {
            inner: Arc::downgrade(&self.inner),
            key,
        }
    }

    /// Resolves when the connection has closed, with why.
    pub(crate) fn closed(&self) -> impl Future<Output = String> + Send + 'static {
        let mut watch = self.inner.closed.subscribe();
        async move {
            loop {
                if let Some(reason) = watch.borrow().clone() {
                    return reason;
                }
                if watch.changed().await.is_err() {
                    return "The connection to the Mostra instance closed.".to_owned();
                }
            }
        }
    }

    /// Closes the connection: pending calls fail, and the writer stops.
    pub(crate) fn close(&self, reason: &str) {
        self.inner.close(reason);
    }
}

/// Removes a notification listener when dropped.
pub(crate) struct ListenGuard {
    inner: std::sync::Weak<Inner>,
    key: u64,
}

impl Drop for ListenGuard {
    fn drop(&mut self) {
        if let Some(inner) = self.inner.upgrade() {
            inner
                .listeners
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .retain(|(key, _)| *key != self.key);
        }
    }
}

/// One message as a line: JSON never contains a raw newline. A line past the protocol's limit is
/// refused here, before anything is written (`MOSTRA_HOST_MESSAGE_TOO_LARGE`).
pub(crate) fn encode(message: &Value) -> Result<String> {
    let mut line = serde_json::to_string(message).map_err(|e| {
        Error::new(
            "MOSTRA_HOST_INTERNAL_ERROR",
            format!("Couldn't encode a message: {e}"),
        )
    })?;
    if line.len() > MAX_LINE_LENGTH && line.encode_utf16().count() > MAX_LINE_LENGTH {
        return Err(Error::new(
            "MOSTRA_HOST_MESSAGE_TOO_LARGE",
            format!(
                "A message of {} bytes is longer than one protocol line may be.",
                line.len()
            ),
        ));
    }
    line.push('\n');
    Ok(line)
}

/// Reads one line (without its newline) into `buffer`; `false` at the end of the stream.
async fn read_line<R: AsyncRead + Unpin>(
    reader: &mut BufReader<R>,
    buffer: &mut Vec<u8>,
) -> std::result::Result<bool, String> {
    loop {
        let available = match reader.fill_buf().await {
            Ok(bytes) => bytes,
            Err(error) => return Err(format!("Reading from the Mostra instance failed: {error}")),
        };
        if available.is_empty() {
            return Ok(!buffer.is_empty());
        }
        if let Some(end) = available.iter().position(|&byte| byte == b'\n') {
            buffer.extend_from_slice(&available[..end]);
            reader.consume(end + 1);
            return Ok(true);
        }
        let taken = available.len();
        buffer.extend_from_slice(available);
        reader.consume(taken);
        if buffer.len() > MAX_LINE_BYTES {
            return Err(
                "The Mostra instance sent a line longer than the protocol allows.".to_owned(),
            );
        }
    }
}

fn dispatch(inner: &Arc<Inner>, line: &[u8], incoming: &Arc<dyn Incoming>) {
    let Ok(message) = serde_json::from_slice::<Value>(line) else {
        return;
    };
    let Some(object) = message.as_object() else {
        return;
    };
    let method = object.get("method").and_then(Value::as_str);
    let id = object.get("id").cloned();
    match (method, id) {
        (Some(method), Some(id)) if !id.is_null() => {
            let params = object.get("params").cloned().unwrap_or(Value::Null);
            let answer = incoming.request(method.to_owned(), params);
            let out = inner.out.clone();
            tokio::spawn(async move {
                let response = match answer.await {
                    Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
                    Err(failure) => json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": {
                            "code": failure.code,
                            "message": failure.diagnostic["message"],
                            "data": failure.diagnostic,
                        },
                    }),
                };
                let line = match encode(&response) {
                    Ok(line) => line,
                    Err(error) => encode(&json!({
                        "jsonrpc": "2.0",
                        "id": response["id"],
                        "error": {
                            "code": -32603,
                            "message": error.message(),
                            "data": diagnostic(error.code(), error.message()),
                        },
                    }))
                    .unwrap_or_default(),
                };
                let _ = out.send(line);
            });
        }
        (Some(method), None) => {
            let params = object.get("params").cloned().unwrap_or(Value::Null);
            let listeners: Vec<Arc<Listener>> = inner
                .listeners
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .iter()
                .map(|(_, listener)| Arc::clone(listener))
                .collect();
            for listener in listeners {
                listener(method, &params);
            }
        }
        (None, Some(Value::Number(number))) => {
            let Some(id) = number.as_u64() else { return };
            let Some(waiter) = inner.lock_pending().remove(&id) else {
                return;
            };
            let outcome = if let Some(error) = object.get("error") {
                let rpc_code = error.get("code").and_then(Value::as_i64);
                match error
                    .get("data")
                    .cloned()
                    .and_then(|data| serde_json::from_value::<Diagnostic>(data).ok())
                {
                    Some(diagnostic) => Err(Error::from_diagnostic(diagnostic, rpc_code)),
                    None => Err(Error::new(
                        "MOSTRA_HOST_INTERNAL_ERROR",
                        error
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("The instance answered with an error without a diagnostic.")
                            .to_owned(),
                    )),
                }
            } else {
                Ok(object.get("result").cloned().unwrap_or(Value::Null))
            };
            let _ = waiter.send(outcome);
        }
        _ => {}
    }
}
