//! Events as a stream of pages (IN-08, D101), in cursor order: `events/subscribe`, then
//! `events/notify` pages. A consumer that falls behind pauses the subscription instead of
//! buffering without bound: past the high-water mark it unsubscribes, and once it has caught up it
//! subscribes again after the last cursor it received, so nothing is missed or repeated. With a
//! name, a page is acknowledged (`events/ack`) when the next one is asked for, which is when the
//! consumer has handled it, and a later stream of that name resumes there.
//!
//! The same orderings the TypeScript SDK meets hold here: a page can arrive before the answer to
//! the subscribe that started it (pages are kept until the answer names their subscription), and
//! an acknowledgement needs a live subscription (a pause acknowledges before it unsubscribes, on
//! the same connection, in that order).

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};
use tokio::sync::Notify;

use crate::error::{Error, Result};
use crate::rpc::{ListenGuard, Peer};
use crate::wire::{Diagnostic, EventFilter, EventRecord, EventsNotifyParams};

/// One page of events.
#[derive(Debug, Clone)]
pub struct EventPage {
    /// The events, in cursor order.
    pub events: Vec<EventRecord>,
    /// Everything up to this cursor was examined: the cursor to resume after.
    pub cursor: String,
    /// Set when compaction removed events in this range (`MOSTRA_HOST_CURSOR_COMPACTED`).
    pub compacted: Option<Diagnostic>,
}

/// Options of a stream.
#[derive(Debug, Clone, Default)]
pub struct EventStreamOptions {
    /// Which events: artifacts and type patterns. Default: every event.
    pub filter: Option<EventFilter>,
    /// Start after this cursor. Default: a named stream's acknowledged cursor, else now.
    pub after: Option<String>,
    /// A durable subscriber name: pages are acknowledged under it as they are handled.
    pub name: Option<String>,
    /// Pages held before the subscription pauses. Default 16.
    pub high_water_mark: Option<usize>,
}

/// Why a stream ended.
enum Ended {
    /// Closed by its consumer.
    Closed,
    /// The connection or the instance ended it.
    Failed(Error),
}

#[derive(Default)]
struct State {
    queue: VecDeque<EventPage>,
    subscription: Option<String>,
    /// The cursor of the last page received, where a resumed subscription starts.
    received: Option<String>,
    /// The cursor of the last page handed out; handled once the next page is asked for.
    handed_out: Option<String>,
    handled: Option<String>,
    acked: Option<String>,
    paused: bool,
    /// Pages of a subscription not known yet, kept while a subscribe is in flight.
    early: Option<Vec<EventsNotifyParams>>,
    /// A subscribe is in flight. Its answer is taken in by a task of its own, so a consumer that
    /// stops waiting (a `select!`, a timeout) never loses the subscription it started.
    subscribing: bool,
    /// A pause's acknowledgement and unsubscribe are still in flight. The flag lives in the
    /// stream's state, not in a handle a consumer's future holds, so a `next()` given up while it
    /// waits for them never lets a resume start before the paused subscription is over (Opus
    /// review of WP-12, finding 5).
    pausing: bool,
    ended: Option<Ended>,
}

struct Shared {
    state: Mutex<State>,
    wake: Notify,
    high: usize,
    named: bool,
    peer: Peer,
}

impl Shared {
    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn end(&self, error: Option<Error>) {
        let mut state = self.lock();
        if state.ended.is_none() {
            state.ended = Some(error.map_or(Ended::Closed, Ended::Failed));
        }
        drop(state);
        self.wake.notify_one();
    }

    /// Takes a page in; past the high-water mark, pauses (from the reader, so in a task).
    fn accept(self: &Arc<Self>, state: &mut State, page: EventsNotifyParams) {
        state.received = Some(page.cursor.to_string());
        state.queue.push_back(EventPage {
            events: page.events,
            cursor: page.cursor.to_string(),
            compacted: page.compacted,
        });
        if state.queue.len() >= self.high && !state.paused {
            state.paused = true;
            let paused_id = state.subscription.clone();
            // The acknowledgement is written before the unsubscribe, while the subscription lives.
            let ack = self.ack_call(state, paused_id.as_deref());
            let unsubscribe = paused_id.clone().map(|id| {
                self.peer
                    .call("events/unsubscribe", json!({ "subscriptionId": id }), None)
            });
            let shared = Arc::clone(self);
            state.pausing = true;
            tokio::spawn(async move {
                if let Some(unsubscribe) = unsubscribe {
                    let _ = unsubscribe.await;
                }
                if let Some(ack) = ack
                    && let Err(error) = ack.await
                {
                    shared.end(Some(error));
                }
                // The answer follows every page of that subscription on the connection, so it is
                // over; a later subscription (a resume) is never touched.
                let mut state = shared.lock();
                if state.subscription == paused_id {
                    state.subscription = None;
                }
                state.pausing = false;
                drop(state);
                shared.wake.notify_one();
            });
        }
        self.wake.notify_one();
    }

    /// Sends `events/ack` now for what a named stream handled beyond what it acknowledged.
    fn ack_call(
        &self,
        state: &mut State,
        id: Option<&str>,
    ) -> Option<impl std::future::Future<Output = Result<Value>> + Send + 'static> {
        let id = id?;
        let cursor = state.handled.clone()?;
        if !self.named || state.acked.as_deref() == Some(cursor.as_str()) {
            return None;
        }
        state.acked = Some(cursor.clone());
        Some(self.peer.call(
            "events/ack",
            json!({ "subscriptionId": id, "cursor": cursor }),
            None,
        ))
    }
}

/// A stream of event pages. Nothing is subscribed until the first page is asked for.
pub struct EventStream {
    shared: Arc<Shared>,
    options: EventStreamOptions,
    started: bool,
    _listener: ListenGuard,
}

impl EventStream {
    pub(crate) fn open(peer: &Peer, options: EventStreamOptions) -> Self {
        let shared = Arc::new(Shared {
            state: Mutex::new(State::default()),
            wake: Notify::new(),
            high: options.high_water_mark.unwrap_or(16).max(1),
            named: options.name.is_some(),
            peer: peer.clone(),
        });
        let listening = Arc::downgrade(&shared);
        let listener = peer.listen(Box::new(move |method, params| {
            if method != "events/notify" {
                return;
            }
            let Some(shared) = listening.upgrade() else {
                return;
            };
            let Ok(page) = serde_json::from_value::<EventsNotifyParams>(params.clone()) else {
                return;
            };
            let mut state = shared.lock();
            if state.ended.is_some() {
                return;
            }
            if state.subscription.as_deref() != Some(page.subscription_id.as_str()) {
                if let Some(early) = state.early.as_mut() {
                    early.push(page);
                }
                return;
            }
            shared.accept(&mut state, page);
        }));
        let closing = Arc::downgrade(&shared);
        let closed = peer.closed();
        tokio::spawn(async move {
            let reason = closed.await;
            if let Some(shared) = closing.upgrade() {
                shared.end(Some(Error::closed(format!(
                    "{reason} (while its events were being read)"
                ))));
            }
        });
        Self {
            shared,
            options,
            started: false,
            _listener: listener,
        }
    }

    /// Starts `events/subscribe` (it is sent now) and takes its answer in a task of its own: the
    /// subscription it names is installed, with the pages that arrived before it, whether or not
    /// anyone still awaits it. A refusal ends the stream with the instance's error.
    fn start_subscribe(&self, after: Option<String>) {
        {
            let mut state = self.shared.lock();
            state.early = Some(Vec::new());
            state.subscribing = true;
        }
        let mut params = serde_json::Map::new();
        if let Some(filter) = &self.options.filter {
            params.insert(
                "filter".into(),
                serde_json::to_value(filter).unwrap_or(Value::Null),
            );
        }
        if let Some(after) = after {
            params.insert("after".into(), Value::String(after));
        }
        if let Some(name) = &self.options.name {
            params.insert("name".into(), Value::String(name.clone()));
        }
        let answer = self
            .shared
            .peer
            .call("events/subscribe", Value::Object(params), None);
        let shared = Arc::clone(&self.shared);
        tokio::spawn(async move {
            let answer = answer.await;
            let mut state = shared.lock();
            state.subscribing = false;
            let early = state.early.take().unwrap_or_default();
            match answer {
                Ok(answer) => {
                    let id = answer["subscriptionId"]
                        .as_str()
                        .unwrap_or_default()
                        .to_owned();
                    state.subscription = Some(id.clone());
                    if state.received.is_none() {
                        state.received = answer["cursor"].as_str().map(str::to_owned);
                    }
                    if state.ended.is_none() {
                        for page in early {
                            if page.subscription_id.as_str() == id {
                                shared.accept(&mut state, page);
                            }
                        }
                    }
                }
                Err(error) => {
                    if state.ended.is_none() {
                        state.ended = Some(Ended::Failed(error));
                    }
                }
            }
            drop(state);
            shared.wake.notify_one();
        });
    }

    /// Waits until no subscribe is in flight; the stream's error when one was refused, once the
    /// pages it already holds are handed out (a failure never discards them, Opus review of WP-12,
    /// finding 6).
    async fn subscribed(&self) -> Result<()> {
        loop {
            let notified = self.shared.wake.notified();
            {
                let state = self.shared.lock();
                if !state.subscribing {
                    return match &state.ended {
                        Some(Ended::Failed(error)) if state.queue.is_empty() => Err(error.clone()),
                        _ => Ok(()),
                    };
                }
            }
            notified.await;
        }
    }

    /// Waits until a pause's acknowledgement and unsubscribe are answered.
    async fn paused_out(&self) {
        loop {
            let notified = self.shared.wake.notified();
            if !self.shared.lock().pausing {
                return;
            }
            notified.await;
        }
    }

    async fn subscribe(&self, after: Option<String>) -> Result<()> {
        self.start_subscribe(after);
        self.subscribed().await
    }

    async fn resume(&self) -> Result<()> {
        self.paused_out().await;
        let after = {
            let mut state = self.shared.lock();
            state.paused = false;
            state.received.clone()
        };
        self.subscribe(after).await
    }

    /// The next page, or `None` once the stream was closed. A page asked for means the one before
    /// it was handled: a named stream acknowledges it.
    ///
    /// # Errors
    ///
    /// The connection closed (`MOSTRA_HOST_CONNECTION_CLOSED`), or the instance refused a
    /// subscription or an acknowledgement.
    pub async fn next(&mut self) -> Result<Option<EventPage>> {
        if !self.started {
            self.started = true;
            self.start_subscribe(self.options.after.clone());
        }
        self.subscribed().await?;
        let resume = {
            let mut state = self.shared.lock();
            if let Some(handed) = state.handed_out.clone() {
                state.handled = Some(handed);
            }
            // A pause still in flight resumes later: the pages held now are handed out first, and
            // an empty queue waits for the pause below.
            state.paused
                && !state.pausing
                && state.ended.is_none()
                && state.queue.len() <= self.shared.high / 2
        };
        if resume {
            self.resume().await?;
        }
        let ack = {
            let mut state = self.shared.lock();
            if state.paused {
                None
            } else {
                let id = state.subscription.clone();
                self.shared.ack_call(&mut state, id.as_deref())
            }
        };
        if let Some(ack) = ack {
            ack.await?;
        }
        loop {
            let notified = self.shared.wake.notified();
            let paused = {
                let mut state = self.shared.lock();
                if let Some(page) = state.queue.pop_front() {
                    state.handed_out = Some(page.cursor.clone());
                    return Ok(Some(page));
                }
                if let Some(ended) = &state.ended {
                    return match ended {
                        Ended::Failed(error) => Err(error.clone()),
                        Ended::Closed => Ok(None),
                    };
                }
                state.paused
            };
            if paused {
                self.resume().await?;
                let ack = {
                    let mut state = self.shared.lock();
                    let id = state.subscription.clone();
                    self.shared.ack_call(&mut state, id.as_deref())
                };
                if let Some(ack) = ack {
                    ack.await?;
                }
                continue;
            }
            notified.await;
        }
    }

    /// Ends the stream: the subscription ends, and a named stream acknowledges every page the
    /// consumer handled, never the last one handed out (the consumer may have stopped inside it).
    ///
    /// # Errors
    ///
    /// Never for a closed connection; the instance's refusals are ignored, since the stream ends
    /// either way.
    pub async fn close(self) -> Result<()> {
        // A subscribe still in flight names a subscription to end too.
        let _ = self.subscribed().await;
        {
            let mut state = self.shared.lock();
            if state.ended.is_none() {
                state.ended = Some(Ended::Closed);
            }
            state.queue.clear();
        }
        self.paused_out().await;
        let (id, ack) = {
            let mut state = self.shared.lock();
            let id = state.subscription.take();
            let ack = self.shared.ack_call(&mut state, id.as_deref());
            (id, ack)
        };
        if let Some(id) = id {
            let unsubscribe =
                self.shared
                    .peer
                    .call("events/unsubscribe", json!({ "subscriptionId": id }), None);
            let _ = unsubscribe.await;
            if let Some(ack) = ack {
                let _ = ack.await;
            }
            return Ok(());
        }
        // Paused when it ended, with pages handled since: subscribe just long enough to
        // acknowledge them.
        let pending = {
            let state = self.shared.lock();
            self.shared.named && state.handled.is_some() && state.handled != state.acked
        };
        if pending {
            let after = self.shared.lock().received.clone();
            if self.subscribe(after).await.is_ok() {
                let (id, ack) = {
                    let mut state = self.shared.lock();
                    let id = state.subscription.take();
                    let ack = self.shared.ack_call(&mut state, id.as_deref());
                    (id, ack)
                };
                if let Some(id) = id {
                    let unsubscribe = self.shared.peer.call(
                        "events/unsubscribe",
                        json!({ "subscriptionId": id }),
                        None,
                    );
                    let _ = unsubscribe.await;
                    if let Some(ack) = ack {
                        let _ = ack.await;
                    }
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{EventStream, EventStreamOptions};
    use crate::rpc::{BoxFuture, Failure, Incoming, Peer};
    use serde_json::{Value, json};
    use std::sync::Arc;
    use std::time::Duration;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::sync::mpsc;

    struct Nobody;
    impl Incoming for Nobody {
        fn request(&self, _: String, _: Value) -> BoxFuture<'static, Result<Value, Failure>> {
            Box::pin(async { Ok(Value::Null) })
        }
    }

    /// A stream whose first `next()` is given up while its subscribe is unanswered still holds the
    /// subscription once the answer comes: its pages arrive, and `close()` ends it (GPT review of
    /// WP-12, finding 2).
    #[tokio::test]
    async fn a_next_given_up_during_subscribe_keeps_the_subscription() {
        let (ours, theirs) = tokio::io::duplex(1 << 16);
        let (reader, writer) = tokio::io::split(ours);
        let peer = Peer::start(reader, writer, Arc::new(Nobody));
        let (their_reader, mut their_writer) = tokio::io::split(theirs);
        let (seen, mut requests) = mpsc::unbounded_channel::<Value>();
        tokio::spawn(async move {
            let mut lines = BufReader::new(their_reader).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = seen.send(serde_json::from_str::<Value>(&line).unwrap_or(Value::Null));
            }
        });
        let mut stream = EventStream::open(
            &peer,
            EventStreamOptions {
                name: Some("host".into()),
                ..Default::default()
            },
        );
        // The consumer stops waiting while the subscribe is unanswered.
        let first = tokio::time::timeout(Duration::from_millis(100), stream.next()).await;
        assert!(first.is_err(), "the subscribe was answered by nobody");
        let subscribe = requests.recv().await.expect("a subscribe was sent");
        assert_eq!(subscribe["method"], "events/subscribe");
        // The answer comes late, and a page follows it.
        let line = |message: Value| {
            let mut line = message.to_string();
            line.push('\n');
            line
        };
        let answer = line(
            json!({ "jsonrpc": "2.0", "id": subscribe["id"], "result": { "subscriptionId": "sub-1", "cursor": "5" } }),
        );
        let page = line(
            json!({ "jsonrpc": "2.0", "method": "events/notify", "params": { "subscriptionId": "sub-1", "events": [], "cursor": "6" } }),
        );
        their_writer.write_all(answer.as_bytes()).await.unwrap();
        their_writer.write_all(page.as_bytes()).await.unwrap();
        let got = tokio::time::timeout(Duration::from_secs(5), stream.next())
            .await
            .expect("the page never came: the subscription was lost")
            .expect("next failed")
            .expect("the stream ended");
        assert_eq!(got.cursor, "6");
        // close() ends the subscription the given-up call started.
        let closing = tokio::spawn(stream.close());
        let unsubscribe = loop {
            let request = requests.recv().await.expect("an unsubscribe was sent");
            if request["method"] == "events/unsubscribe" {
                break request;
            }
            let id = request["id"].clone();
            let reply = line(json!({ "jsonrpc": "2.0", "id": id, "result": {} }));
            their_writer.write_all(reply.as_bytes()).await.unwrap();
        };
        assert_eq!(unsubscribe["params"]["subscriptionId"], "sub-1");
        let reply = line(json!({ "jsonrpc": "2.0", "id": unsubscribe["id"], "result": {} }));
        their_writer.write_all(reply.as_bytes()).await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), closing)
            .await
            .expect("close never ended")
            .expect("close panicked")
            .expect("close failed");
    }

    /// An instance played by hand: the requests the stream sends, and lines written back.
    struct Fake {
        requests: mpsc::UnboundedReceiver<Value>,
        writer: Option<tokio::io::WriteHalf<tokio::io::DuplexStream>>,
    }

    impl Fake {
        fn start() -> (Peer, Self) {
            let (ours, theirs) = tokio::io::duplex(1 << 20);
            let (reader, writer) = tokio::io::split(ours);
            let peer = Peer::start(reader, writer, Arc::new(Nobody));
            let (their_reader, their_writer) = tokio::io::split(theirs);
            let (seen, requests) = mpsc::unbounded_channel::<Value>();
            tokio::spawn(async move {
                let mut lines = BufReader::new(their_reader).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = seen.send(serde_json::from_str::<Value>(&line).unwrap_or(Value::Null));
                }
            });
            (
                peer,
                Self {
                    requests,
                    writer: Some(their_writer),
                },
            )
        }

        async fn send(&mut self, message: Value) {
            let mut line = message.to_string();
            line.push('\n');
            let writer = self.writer.as_mut().expect("open");
            writer.write_all(line.as_bytes()).await.unwrap();
        }

        async fn expect(&mut self, method: &str) -> Value {
            let request = tokio::time::timeout(Duration::from_secs(5), self.requests.recv())
                .await
                .expect("no request came")
                .expect("the connection ended");
            assert_eq!(request["method"], method, "{request}");
            request
        }

        async fn answer(&mut self, request: &Value, result: Value) {
            self.send(json!({ "jsonrpc": "2.0", "id": request["id"], "result": result }))
                .await;
        }

        async fn page(&mut self, subscription: &str, cursor: &str) {
            self.send(json!({ "jsonrpc": "2.0", "method": "events/notify",
                "params": { "subscriptionId": subscription, "events": [], "cursor": cursor } }))
                .await;
        }
    }

    async fn next_cursor(stream: &mut EventStream) -> String {
        tokio::time::timeout(Duration::from_secs(5), stream.next())
            .await
            .expect("no page")
            .expect("next failed")
            .expect("ended")
            .cursor
    }

    /// A `next()` given up while a pause's unsubscribe is unanswered never lets the next `next()`
    /// subscribe again before it is: the pages the paused subscription still sends and the new
    /// subscription's replay never overlap (Opus review of WP-12, finding 5).
    #[tokio::test]
    async fn a_resume_given_up_never_repeats_pages() {
        let (peer, mut fake) = Fake::start();
        let mut stream = EventStream::open(
            &peer,
            EventStreamOptions {
                high_water_mark: Some(2),
                ..Default::default()
            },
        );
        let first = tokio::spawn(async move {
            let cursor = next_cursor(&mut stream).await;
            (stream, cursor)
        });
        let subscribe = fake.expect("events/subscribe").await;
        fake.answer(
            &subscribe,
            json!({ "subscriptionId": "sub-1", "cursor": "0" }),
        )
        .await;
        fake.page("sub-1", "1").await;
        fake.page("sub-1", "2").await;
        let (mut stream, cursor) = first.await.unwrap();
        assert_eq!(cursor, "1");
        // Two pages: the stream paused, and its unsubscribe waits for an answer.
        let unsubscribe = fake.expect("events/unsubscribe").await;
        let mut seen = vec![cursor, next_cursor(&mut stream).await];
        // The consumer gives up a next() while the pause is still in flight.
        assert!(
            tokio::time::timeout(Duration::from_millis(100), stream.next())
                .await
                .is_err()
        );
        // The next next() must wait for the unsubscribe's answer before it subscribes again.
        let resumed = tokio::spawn(async move {
            let mut cursors = Vec::new();
            for _ in 0..2 {
                cursors.push(next_cursor(&mut stream).await);
            }
            cursors
        });
        tokio::time::sleep(Duration::from_millis(100)).await;
        // A page of the paused subscription, sent before its unsubscribe's answer.
        fake.page("sub-1", "3").await;
        fake.answer(&unsubscribe, json!({})).await;
        let again = fake.expect("events/subscribe").await;
        assert_eq!(
            again["params"]["after"], "3",
            "the new subscription starts after page 3"
        );
        fake.answer(&again, json!({ "subscriptionId": "sub-2", "cursor": "3" }))
            .await;
        fake.page("sub-2", "4").await;
        seen.extend(resumed.await.unwrap());
        assert_eq!(seen, ["1", "2", "3", "4"]);
    }

    /// Pages the stream holds are handed out before the connection's end is reported (Opus review
    /// of WP-12, finding 6).
    #[tokio::test]
    async fn a_failure_hands_out_the_pages_it_holds_first() {
        let (peer, mut fake) = Fake::start();
        let mut stream = EventStream::open(&peer, EventStreamOptions::default());
        let first = tokio::spawn(async move {
            let cursor = next_cursor(&mut stream).await;
            (stream, cursor)
        });
        let subscribe = fake.expect("events/subscribe").await;
        fake.answer(
            &subscribe,
            json!({ "subscriptionId": "sub-1", "cursor": "0" }),
        )
        .await;
        for cursor in ["1", "2", "3"] {
            fake.page("sub-1", cursor).await;
        }
        let (mut stream, cursor) = first.await.unwrap();
        assert_eq!(cursor, "1");
        // The instance goes away with two pages still held.
        if let Some(mut writer) = fake.writer.take() {
            writer.shutdown().await.unwrap();
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(next_cursor(&mut stream).await, "2");
        assert_eq!(next_cursor(&mut stream).await, "3");
        let end = tokio::time::timeout(Duration::from_secs(5), stream.next())
            .await
            .expect("the end was never reported")
            .unwrap_err();
        assert_eq!(end.code(), "MOSTRA_HOST_CONNECTION_CLOSED");
    }
}
