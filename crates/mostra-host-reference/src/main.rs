//! The Rust reference host of Mostra's conformance kit (HO-05): a host built on `mostra-host` the
//! way the crate's docs recommend, with every port the crate serves and a store that keeps each
//! submission once by its `deliveryId` (H-03), driven by the kit through the harness protocol on
//! stdin and stdout (`@mostra/conformance`, `src/harness/protocol.ts`).
//!
//! ```text
//! mostra-host-reference                      every port
//! mostra-host-reference --standalone         no port: Mostra's built-in adapters
//! mostra-host-reference --break <fault,…>    store-duplicates, drafts-as-submissions, ignore-policy
//! ```
//!
//! It spawns its instance or attaches to the home's daemon (`harness/start`'s `mode`), so the
//! kit's outbox-replay scenario, which needs a host that goes away while Mostra keeps running,
//! runs against it. Copy it to start a Rust host's own shim.

use std::collections::{BTreeMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use mostra_host::ports::{
    Addressing, Delivered, Delivery, Drafts, Identity, Person, PortError, Secrets, Submissions,
    TrustedControls,
};
use mostra_host::wire::{
    ArtifactSummary, ControlsPolicy, DraftMirror, EventFilter, ExternalBase,
    PortAddressingExternalBaseParams, PortAddressingExternalBaseParamsListener,
    PortIdentityResolveParams, PortSecretsGetParams, PortTrustedControlsActivatedParams,
};
use mostra_host::{EventStreamOptions, Mostra, Options};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{RwLock, mpsc};

/// The faults a broken reference host can carry.
const FAULTS: [&str; 3] = ["store-duplicates", "drafts-as-submissions", "ignore-policy"];

/// The harness protocol revision this shim speaks.
const HARNESS_REVISION: &str = "2026-10-21";

/// One delivery as the store keeps it.
struct Entry {
    record: serde_json::Map<String, Value>,
    calls: u64,
    copies: u64,
    attempts: Vec<u64>,
}

/// How the scripted ports answer, and what every port saw: a real host's database.
struct State {
    deliveries: Vec<(String, Entry)>,
    drafts: Vec<Value>,
    activations: Vec<Value>,
    identity: Vec<Value>,
    policies: Vec<Value>,
    secrets_asked: Vec<Value>,
    addressing: Vec<Value>,
    /// No external base until scripted: the loopback ports every other scenario expects.
    base: Value,
    deliver: String,
    policy: Value,
    person: Value,
    secret_values: BTreeMap<String, String>,
}

/// The reference host's store, shared by its ports and the harness.
#[derive(Clone)]
struct Store {
    state: Arc<Mutex<State>>,
    faults: Arc<HashSet<String>>,
}

impl Store {
    fn new(faults: HashSet<String>) -> Self {
        Self {
            state: Arc::new(Mutex::new(State {
                deliveries: Vec::new(),
                drafts: Vec::new(),
                activations: Vec::new(),
                identity: Vec::new(),
                policies: Vec::new(),
                secrets_asked: Vec::new(),
                addressing: Vec::new(),
                base: Value::Null,
                deliver: "accept".into(),
                policy: json!({ "submitChannels": ["shell"], "controls": ["submit", "choose", "approve"] }),
                person: json!("headers"),
                secret_values: BTreeMap::new(),
            })),
            faults: Arc::new(faults),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Records a delivery once per ID, as a host's database with a unique key would.
    fn record(&self, id: String, attempt: u64, record: serde_json::Map<String, Value>) {
        let duplicates = self.faults.contains("store-duplicates");
        let mut state = self.lock();
        if let Some((_, existing)) = state.deliveries.iter_mut().find(|(key, _)| *key == id) {
            existing.calls += 1;
            existing.attempts.push(attempt);
            if duplicates {
                existing.copies += 1;
            }
            return;
        }
        state.deliveries.push((
            id,
            Entry {
                record,
                calls: 1,
                copies: 1,
                attempts: vec![attempt],
            },
        ));
    }

    fn snapshot(&self) -> Value {
        let state = self.lock();
        let deliveries: Vec<Value> = state
            .deliveries
            .iter()
            .enumerate()
            .map(|(index, (_, entry))| {
                let mut record = entry.record.clone();
                record.insert("calls".into(), json!(entry.calls));
                record.insert("stored".into(), json!(entry.copies));
                record.insert("attempts".into(), json!(entry.attempts));
                record.insert("order".into(), json!(index + 1));
                Value::Object(record)
            })
            .collect();
        json!({
            "deliveries": deliveries,
            "drafts": state.drafts,
            "activations": state.activations,
            "identity": state.identity,
            "policies": state.policies,
            "secrets": state.secrets_asked,
            "addressing": state.addressing,
        })
    }

    fn script(&self, params: &Value) -> Result<(), String> {
        let answer = params.get("answer").cloned().unwrap_or(Value::Null);
        let mut state = self.lock();
        match params.get("port").and_then(Value::as_str) {
            Some("submissions") => {
                state.deliver = answer
                    .as_str()
                    .ok_or("a submissions answer is a string")?
                    .into();
            }
            Some("trustedControls") => state.policy = answer,
            Some("identity") => state.person = answer,
            Some("addressing") => state.base = answer,
            Some("secrets") => {
                state.secret_values = serde_json::from_value(answer).map_err(|e| e.to_string())?;
            }
            other => return Err(format!("no scripted port {other:?}")),
        }
        Ok(())
    }
}

/// Never answers: a port that hangs, so Mostra's own time limit decides.
async fn hang<T>() -> T {
    std::future::pending().await
}

impl Submissions for Store {
    async fn deliver(&self, delivery: Delivery) -> Result<Delivered, PortError> {
        let answer = self.lock().deliver.clone();
        match answer.as_str() {
            "fail" => return Err(PortError::new("the host's store is unavailable")),
            "hang" => return hang().await,
            "retry" => return Ok(Delivered::RetryLater("busy".into())),
            "undeliverable" => return Ok(Delivered::Undeliverable),
            "reject" => return Ok(Delivered::Rejected("invalid".into())),
            _ => {}
        }
        let envelope = serde_json::to_value(&delivery.envelope).unwrap_or(Value::Null);
        let submission = &envelope["results"]["submission"];
        let mut record = serde_json::Map::new();
        record.insert("deliveryId".into(), envelope["deliveryId"].clone());
        record.insert("submissionId".into(), envelope["submissionId"].clone());
        record.insert("artifactId".into(), envelope["artifactId"].clone());
        record.insert("kind".into(), envelope["kind"].clone());
        record.insert("channel".into(), submission["channel"].clone());
        record.insert("viewerKind".into(), submission["viewer"]["kind"].clone());
        if let Some(reference) = submission["viewer"].get("ref") {
            record.insert("viewerRef".into(), reference.clone());
        }
        let id = envelope["deliveryId"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        let attempt = envelope["attempt"].as_u64().unwrap_or(1);
        // A redelivery of a delivery the store holds is accepted again, never stored twice.
        self.record(id, attempt, record);
        Ok(Delivered::Accepted)
    }
}

impl Drafts for Store {
    async fn mirror(&self, draft: DraftMirror) -> Result<(), PortError> {
        let value = serde_json::to_value(&draft).unwrap_or(Value::Null);
        self.lock().drafts.push(json!({
            "artifactId": value["artifactId"],
            "viewerId": value["viewerId"],
            "revision": value["revision"],
            "kind": value["kind"],
        }));
        if self.faults.contains("drafts-as-submissions") {
            let mut record = serde_json::Map::new();
            record.insert(
                "deliveryId".into(),
                json!(format!("draft-{}-{}", value["viewerId"], value["revision"])),
            );
            record.insert("submissionId".into(), json!(""));
            record.insert("artifactId".into(), value["artifactId"].clone());
            record.insert("kind".into(), value["kind"].clone());
            record.insert("channel".into(), json!(""));
            record.insert("viewerKind".into(), json!(""));
            let id = format!("draft-{}-{}", value["viewerId"], value["revision"]);
            self.record(id, 1, record);
        }
        Ok(())
    }
}

impl Identity for Store {
    async fn resolve(
        &self,
        request: PortIdentityResolveParams,
    ) -> Result<Option<Person>, PortError> {
        let mut call = json!({
            "artifactId": request.artifact_id.to_string(),
            "via": request.via.to_string(),
            "headers": request.headers.keys().collect::<Vec<_>>(),
        });
        let answer = self.lock().person.clone();
        // What the host answers is recorded beside the call (absent when it fails or hangs), so
        // the kit judges the session by this host's own way of naming people.
        let person = match answer {
            Value::String(kind) if kind == "fail" || kind == "hang" => {
                self.lock().identity.push(call);
                if kind == "fail" {
                    return Err(PortError::new("the host's directory is unavailable"));
                }
                return hang().await;
            }
            Value::String(kind) if kind == "headers" => {
                request.headers.get("x-forwarded-user").map(|user| {
                    (
                        user.clone(),
                        Some(user.split('@').next().unwrap_or(user).to_owned()),
                    )
                })
            }
            Value::Object(person) => Some((
                person
                    .get("ref")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                person
                    .get("name")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            )),
            _ => None,
        };
        call["answer"] = person.as_ref().map_or(Value::Null, |(reference, name)| {
            let mut answer = json!({ "ref": reference });
            if let Some(name) = name {
                answer["name"] = json!(name);
            }
            answer
        });
        self.lock().identity.push(call);
        Ok(person.map(|(reference, name)| match name {
            Some(name) => Person::new(reference).named(name),
            None => Person::new(reference),
        }))
    }
}

impl TrustedControls for Store {
    async fn policy(&self, artifact: ArtifactSummary) -> Result<ControlsPolicy, PortError> {
        let id = artifact.id.to_string();
        let mut answer = self.lock().policy.clone();
        if self.faults.contains("ignore-policy") {
            answer = json!({ "submitChannels": ["shell", "artifact"] });
        }
        match answer {
            Value::String(kind) if kind == "fail" || kind == "hang" => {
                self.lock().policies.push(json!({ "artifactId": id }));
                if kind == "fail" {
                    return Err(PortError::new("the host's policy service is unavailable"));
                }
                hang().await
            }
            policy => {
                self.lock()
                    .policies
                    .push(json!({ "artifactId": id, "answer": policy.clone() }));
                serde_json::from_value(policy).map_err(|e| PortError::new(e.to_string()))
            }
        }
    }

    async fn activated(&self, event: PortTrustedControlsActivatedParams) -> Result<(), PortError> {
        let value = serde_json::to_value(&event).unwrap_or(Value::Null);
        self.lock().activations.push(json!({
            "artifactId": value["artifactId"],
            "control": value["control"],
            "viewId": value["viewId"],
        }));
        Ok(())
    }
}

impl Addressing for Store {
    async fn external_base(
        &self,
        request: PortAddressingExternalBaseParams,
    ) -> Result<Option<ExternalBase>, PortError> {
        let mut state = self.lock();
        let shell = request.listener == PortAddressingExternalBaseParamsListener::Shell;
        let listener = if shell { "shell" } else { "artifact" };
        let call = json!({
            "artifactId": request.artifact_id.to_string(),
            "listener": listener,
            "local": request.local.to_string(),
        });
        let base = state.base.clone();
        if base.as_str() == Some("fail") {
            state.addressing.push(call);
            return Err(PortError::new("the host's tunnel is unavailable"));
        }
        if base.is_null() {
            let mut entry = call;
            entry["answer"] = Value::Null;
            state.addressing.push(entry);
            return Ok(None);
        }
        let host = base[if shell { "shellHost" } else { "artifactHost" }]
            .as_str()
            .unwrap_or("127.0.0.1");
        let port = request
            .local
            .rsplit(':')
            .next()
            .unwrap_or_default()
            .trim_end_matches('/');
        let mut answer = json!({ "origin": format!("http://{host}:{port}") });
        if let Some(mode) = base["mode"].as_str() {
            answer["mode"] = json!(mode);
        }
        let mut entry = call;
        entry["answer"] = answer.clone();
        state.addressing.push(entry);
        serde_json::from_value(answer)
            .map(Some)
            .map_err(|error| PortError::new(error.to_string()))
    }
}

impl Secrets for Store {
    async fn get(&self, request: PortSecretsGetParams) -> Result<Option<String>, PortError> {
        let mut state = self.lock();
        state
            .secrets_asked
            .push(json!({ "artifactId": request.artifact_id, "name": request.name }));
        Ok(state.secret_values.get(&request.name).cloned())
    }
}

/// The host: its store, its ports and its current session.
struct Host {
    name: &'static str,
    standalone: bool,
    store: Store,
    mostra: RwLock<Option<Arc<Mostra>>>,
}

/// A harness error: a JSON-RPC code and a diagnostic.
fn failure(code: i64, diagnostic: &str, message: impl Into<String>) -> Value {
    json!({ "code": code, "message": message.into(), "data": {
        "code": diagnostic, "severity": "error", "message": "", "phase": "host",
        "docs": format!("https://mostra-dev.github.io/mostra/errors/{diagnostic}"),
    }})
}

impl Host {
    fn ports(&self) -> Vec<&'static str> {
        if self.standalone {
            Vec::new()
        } else {
            vec![
                "submissions",
                "drafts",
                "identity",
                "addressing",
                "trustedControls",
                "secrets",
            ]
        }
    }

    async fn current(&self) -> Result<Arc<Mostra>, Value> {
        self.mostra
            .read()
            .await
            .clone()
            .ok_or_else(|| failure(-32000, "MOSTRA_HOST_CONNECTION_CLOSED", "No instance runs."))
    }

    async fn start(&self, params: &Value) -> Result<Value, Value> {
        self.stop().await;
        let home = params["home"].as_str().unwrap_or_default();
        let mut env: BTreeMap<String, String> = std::env::vars().collect();
        if let Some(extra) = params["env"].as_object() {
            for (key, value) in extra {
                env.insert(key.clone(), value.as_str().unwrap_or_default().to_owned());
            }
        }
        let mut options = Options::new(home).client(self.name, "0").env(env);
        if !self.standalone {
            options = options
                .submissions(self.store.clone())
                .drafts(self.store.clone())
                .identity(self.store.clone())
                .addressing(self.store.clone())
                .trusted_controls(self.store.clone())
                .secrets(self.store.clone());
        }
        let attach = params["mode"].as_str() == Some("attach");
        let mostra = if attach {
            Mostra::attach(options).await
        } else {
            Mostra::spawn(options).await
        }
        .map_err(|error| {
            failure(
                error.rpc_code().unwrap_or(-32000),
                error.code(),
                error.message().to_owned(),
            )
        })?;
        let answer = json!({
            "revision": mostra.revision(),
            "instance": serde_json::to_value(mostra.instance()).unwrap_or(Value::Null),
            "warnings": serde_json::to_value(mostra.warnings()).unwrap_or(json!([])),
        });
        *self.mostra.write().await = Some(Arc::new(mostra));
        Ok(answer)
    }

    async fn stop(&self) {
        let current = self.mostra.write().await.take();
        if let Some(mostra) = current {
            let _ = mostra.close().await;
        }
    }

    async fn call(&self, params: &Value) -> Result<Value, Value> {
        let mostra = self.current().await?;
        let method = params["method"].as_str().unwrap_or_default();
        let timeout = params["timeoutMs"].as_u64().map(Duration::from_millis);
        Ok(
            match mostra
                .call_raw(method, params["params"].clone(), timeout)
                .await
            {
                Ok(result) => json!({ "result": result }),
                Err(error) => {
                    let data = error.diagnostic().map_or_else(
                        || json!({ "code": error.code(), "message": error.message() }),
                        |diagnostic| serde_json::to_value(diagnostic).unwrap_or(Value::Null),
                    );
                    json!({ "error": { "code": error.rpc_code().unwrap_or(-32000), "data": data } })
                }
            },
        )
    }

    async fn events(&self, params: &Value) -> Result<Value, Value> {
        let mostra = self.current().await?;
        let filter: Option<EventFilter> = serde_json::from_value(params["filter"].clone()).ok();
        let mut stream = mostra.events(EventStreamOptions {
            filter,
            name: params["name"].as_str().map(str::to_owned),
            ..EventStreamOptions::default()
        });
        let wanted = usize::try_from(params["pages"].as_u64().unwrap_or(1)).unwrap_or(1);
        let deadline = tokio::time::Instant::now()
            + Duration::from_millis(params["timeoutMs"].as_u64().unwrap_or(1000));
        let mut pages = Vec::new();
        while pages.len() < wanted {
            match tokio::time::timeout_at(deadline, stream.next()).await {
                Ok(Ok(Some(page))) => pages.push(json!({
                    "cursor": page.cursor,
                    "events": serde_json::to_value(&page.events).unwrap_or(json!([])),
                })),
                Ok(Ok(None)) | Err(_) => break,
                Ok(Err(error)) => {
                    return Err(failure(-32000, error.code(), error.message().to_owned()));
                }
            }
        }
        // Asking for the next page acknowledges the last one handled; the wait is cut short.
        let _ = tokio::time::timeout(Duration::from_secs(1), stream.next()).await;
        let _ = stream.close().await;
        Ok(json!({ "pages": pages }))
    }

    async fn handle(&self, method: &str, params: &Value) -> Result<Value, Value> {
        match method {
            "harness/initialize" => {
                let mut features = vec!["attach", "events"];
                if !self.standalone {
                    features.push("faults");
                }
                Ok(json!({
                    "revision": HARNESS_REVISION,
                    "host": { "name": self.name, "version": env!("CARGO_PKG_VERSION") },
                    "ports": self.ports(),
                    "features": features,
                }))
            }
            "harness/start" => self.start(params).await,
            "harness/call" => self.call(params).await,
            "harness/stop" => {
                self.stop().await;
                Ok(json!({}))
            }
            "harness/store" => Ok(self.store.snapshot()),
            "harness/script" if !self.standalone => self
                .store
                .script(params)
                .map(|()| json!({}))
                .map_err(|message| failure(-32602, "MOSTRA_HOST_INVALID_PARAMS", message)),
            "harness/events" => self.events(params).await,
            _ => Err(failure(
                -32601,
                "MOSTRA_HOST_METHOD_UNKNOWN",
                format!("This host serves no harness method {method}."),
            )),
        }
    }
}

fn arguments() -> Result<(bool, HashSet<String>), String> {
    let mut standalone = false;
    let mut faults = HashSet::new();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--standalone" => standalone = true,
            "--break" => {
                let list = args.next().ok_or("--break needs a list of faults")?;
                for fault in list.split(',').filter(|fault| !fault.is_empty()) {
                    if !FAULTS.contains(&fault) {
                        return Err(format!(
                            "Unknown fault {fault}; known: {}",
                            FAULTS.join(", ")
                        ));
                    }
                    faults.insert(fault.to_owned());
                }
            }
            other => return Err(format!("Unknown argument {other}")),
        }
    }
    Ok((standalone, faults))
}

#[tokio::main]
async fn main() {
    let (standalone, faults) = match arguments() {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("mostra-host-reference: {message}");
            std::process::exit(2);
        }
    };
    let name = if standalone {
        "reference-host-rust-standalone"
    } else if faults.is_empty() {
        "reference-host-rust"
    } else {
        "reference-host-rust-broken"
    };
    let host = Arc::new(Host {
        name,
        standalone,
        store: Store::new(faults),
        mostra: RwLock::new(None),
    });
    let (sender, mut outgoing) = mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(line) = outgoing.recv().await {
            if stdout.write_all(line.as_bytes()).await.is_err() || stdout.flush().await.is_err() {
                break;
            }
        }
    });
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    // Requests are answered concurrently: a `wait` in flight never holds up the next request.
    while let Ok(Some(line)) = lines.next_line().await {
        let Ok(request) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let host = Arc::clone(&host);
        let sender = sender.clone();
        tokio::spawn(async move {
            let method = request["method"].as_str().unwrap_or_default().to_owned();
            let outcome = host.handle(&method, &request["params"]).await;
            let Some(id) = request.get("id").cloned() else {
                return;
            };
            let response = match outcome {
                Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
                Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error }),
            };
            let _ = sender.send(format!("{response}\n"));
        });
    }
    host.stop().await;
    drop(sender);
    let _ = writer.await;
}
