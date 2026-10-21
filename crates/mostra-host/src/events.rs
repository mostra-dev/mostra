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
use tokio::task::JoinHandle;

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
    pausing: Option<JoinHandle<()>>,
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
            state.pausing = Some(tokio::spawn(async move {
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
            }));
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

    async fn subscribe(&self, after: Option<String>) -> Result<()> {
        self.shared.lock().early = Some(Vec::new());
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
            .call("events/subscribe", Value::Object(params), None)
            .await;
        let mut state = self.shared.lock();
        let early = state.early.take().unwrap_or_default();
        let answer = answer?;
        let id = answer["subscriptionId"]
            .as_str()
            .unwrap_or_default()
            .to_owned();
        state.subscription = Some(id.clone());
        if state.received.is_none() {
            state.received = answer["cursor"].as_str().map(str::to_owned);
        }
        for page in early {
            if page.subscription_id.as_str() == id {
                self.shared.accept(&mut state, page);
            }
        }
        Ok(())
    }

    async fn resume(&self) -> Result<()> {
        let pausing = self.shared.lock().pausing.take();
        if let Some(pausing) = pausing {
            let _ = pausing.await;
        }
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
            self.subscribe(self.options.after.clone()).await?;
        }
        let resume = {
            let mut state = self.shared.lock();
            if let Some(handed) = state.handed_out.clone() {
                state.handled = Some(handed);
            }
            state.paused && state.ended.is_none() && state.queue.len() <= self.shared.high / 2
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
        let pausing = {
            let mut state = self.shared.lock();
            if state.ended.is_none() {
                state.ended = Some(Ended::Closed);
            }
            state.queue.clear();
            state.pausing.take()
        };
        if let Some(pausing) = pausing {
            let _ = pausing.await;
        }
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
