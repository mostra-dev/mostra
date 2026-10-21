//! The host ports (INTERFACES §7, D58, D143): what Mostra asks of a host on the connection that
//! registered them. Every port is optional, and every call is idempotent by its stable ID, so a
//! port may see the same call again after a crash. A host implements the traits it needs with
//! ordinary `async fn`s and passes them to [`crate::Options`].
//!
//! ```no_run
//! use mostra_host::ports::{Delivered, Delivery, PortError, Submissions};
//!
//! struct Inbox;
//!
//! impl Submissions for Inbox {
//!     async fn deliver(&self, delivery: Delivery) -> Result<Delivered, PortError> {
//!         // Store `delivery.raw` keyed by `delivery.envelope.delivery_id`, idempotently.
//!         Ok(Delivered::Accepted)
//!     }
//! }
//! ```
//!
//! This release calls `identity`, `submissions`, `drafts`, `trustedControls` and `secrets`;
//! `addressing` arrives with sharing, `reviews` and `capture` with the review layer, `pty` with
//! terminals, each as a new trait (D143 item 1).

use std::future::Future;
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use serde_json::value::RawValue;

use crate::rpc::{BoxFuture, Failure, Incoming};
use crate::wire::{
    ArtifactSummary, ControlsPolicy, DraftMirror, PortIdentityResolveParams, PortSecretsGetParams,
    PortTrustedControlsActivatedParams, PortTrustedControlsPolicyParams, SubmissionEnvelope,
};

/// A host's failure to answer a port call. Mostra treats it as a failed attempt: a delivery is
/// retried with backoff (D105); a policy narrows to the shell channel (D108); an identity refuses
/// the link (D143); a secret is missing (D131).
#[derive(Debug, Clone)]
pub struct PortError {
    message: String,
    /// The instance's params didn't read as the method's: answered -32602, never the host's fault.
    invalid_params: bool,
}

impl PortError {
    /// A failure, with what went wrong.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            invalid_params: false,
        }
    }

    /// What went wrong.
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl std::fmt::Display for PortError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for PortError {}

/// A person, as the host knows them: its stable key and a display name (D104, D143).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Person {
    /// The host's stable key for this person: the same key is always the same viewer.
    #[serde(rename = "ref")]
    pub reference: String,
    /// The name people see.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl Person {
    /// A person by key.
    pub fn new(reference: impl Into<String>) -> Self {
        Self {
            reference: reference.into(),
            name: None,
        }
    }

    /// With a display name.
    #[must_use]
    pub fn named(mut self, name: impl Into<String>) -> Self {
        self.name = Some(name.into());
        self
    }
}

/// `identity`: names the person behind a link minted without a viewer (D143 item 2).
pub trait Identity: Send + Sync + 'static {
    /// The person the request's headers name, or `None` for the home's local user. Answer
    /// within 5 s; a failure refuses the link rather than guess.
    fn resolve(
        &self,
        request: PortIdentityResolveParams,
    ) -> impl Future<Output = Result<Option<Person>, PortError>> + Send;
}

/// One submission delivered to the host (D105): the typed envelope, and its exact JSON for a host
/// that stores the payload opaquely (H-01).
#[derive(Debug, Clone)]
pub struct Delivery {
    /// The envelope: `deliveryId` (stable across redeliveries), `attempt` and the full results.
    pub envelope: SubmissionEnvelope,
    /// The envelope as it arrived.
    pub raw: Box<RawValue>,
}

/// A host's answer to a delivery (INTERFACES §7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Delivered {
    /// The host holds the submission now.
    Accepted,
    /// The host already holds it (an earlier attempt landed): counts as delivered.
    Duplicate,
    /// The host can never take it (the session it was for is gone): shown to the viewer.
    Undeliverable,
    /// The host refuses it for good, with a reason. The reasons `duplicate` and `undeliverable`
    /// mean something else to Mostra, so they travel as `rejected: <reason>` (use
    /// [`Delivered::Duplicate`] or [`Delivered::Undeliverable`] for those), and an empty reason
    /// is `rejected`.
    Rejected(String),
    /// The host can't take it now: Mostra keeps it pending and tries again with backoff. An empty
    /// reason is `retry later`.
    RetryLater(String),
}

impl Delivered {
    fn wire(&self) -> Value {
        match self {
            Self::Accepted => serde_json::json!({ "accepted": true }),
            Self::Duplicate => {
                serde_json::json!({ "accepted": false, "reason": "duplicate", "retry": false })
            }
            Self::Undeliverable => {
                serde_json::json!({ "accepted": false, "reason": "undeliverable", "retry": false })
            }
            // Only the variants of their own give the reserved reasons, and the protocol needs a
            // reason (Opus review of WP-12, finding 4): a `Rejected("duplicate")` would otherwise
            // count as delivered, and an empty reason would be retried forever.
            Self::Rejected(reason) => {
                let reason = match reason.trim() {
                    "" => "rejected".to_owned(),
                    reserved @ ("duplicate" | "undeliverable") => format!("rejected: {reserved}"),
                    _ => reason.clone(),
                };
                serde_json::json!({ "accepted": false, "reason": reason, "retry": false })
            }
            Self::RetryLater(reason) => {
                let reason = if reason.trim().is_empty() {
                    "retry later"
                } else {
                    reason
                };
                serde_json::json!({ "accepted": false, "reason": reason, "retry": true })
            }
        }
    }
}

/// `submissions`: receives each submission once it is durable (D58, D105).
pub trait Submissions: Send + Sync + 'static {
    /// Stores the submission, idempotently by `envelope.delivery_id`. Answer within 30 s.
    fn deliver(
        &self,
        delivery: Delivery,
    ) -> impl Future<Output = Result<Delivered, PortError>> + Send;
}

/// `drafts`: receives each viewer draft's latest revision, best effort and never retried
/// (IN-06). A mirror is always `kind: "draft"`, never a submission.
pub trait Drafts: Send + Sync + 'static {
    /// Mirrors the draft.
    fn mirror(&self, draft: DraftMirror) -> impl Future<Output = Result<(), PortError>> + Send;
}

/// `trustedControls`: decides each view's submit channels and trusted controls (D108).
pub trait TrustedControls: Send + Sync + 'static {
    /// The channels and controls for a new view of `artifact`. Answer within 5 s; a failure
    /// narrows the view to the shell channel.
    fn policy(
        &self,
        artifact: ArtifactSummary,
    ) -> impl Future<Output = Result<ControlsPolicy, PortError>> + Send;

    /// A trusted control was used and its change committed (best effort, never retried).
    fn activated(
        &self,
        event: PortTrustedControlsActivatedParams,
    ) -> impl Future<Output = Result<(), PortError>> + Send {
        let _ = event;
        async { Ok(()) }
    }
}

/// `secrets`: answers `secret()` before the home's own store (D131).
pub trait Secrets: Send + Sync + 'static {
    /// The value, or `None` to fall back to the artifact's and the home's store. Answer within
    /// 30 s; a failure makes `secret()` fail, never fall back.
    fn get(
        &self,
        request: PortSecretsGetParams,
    ) -> impl Future<Output = Result<Option<String>, PortError>> + Send;
}

/// A callback for a port handler's failure: the method and what went wrong.
pub(crate) type ErrorCallback = Arc<dyn Fn(&str, &str) + Send + Sync>;

type Handler = Arc<dyn Fn(Value) -> BoxFuture<'static, Result<Value, PortError>> + Send + Sync>;

/// The ports a host serves, by method.
#[derive(Default, Clone)]
pub(crate) struct PortSet {
    handlers: Vec<(&'static str, &'static str, Handler)>,
    on_error: Option<ErrorCallback>,
}

fn parse<T: serde::de::DeserializeOwned>(params: Value) -> Result<T, PortError> {
    serde_json::from_value(params).map_err(|e| PortError {
        message: format!("invalid params: {e}"),
        invalid_params: true,
    })
}

impl PortSet {
    /// The port names registered, in registration order without repeats.
    pub(crate) fn names(&self) -> Vec<&'static str> {
        let mut names: Vec<&'static str> = Vec::new();
        for (port, _, _) in &self.handlers {
            if !names.contains(port) {
                names.push(port);
            }
        }
        names
    }

    fn add(&mut self, port: &'static str, method: &'static str, handler: Handler) {
        self.handlers.retain(|(_, existing, _)| *existing != method);
        self.handlers.push((port, method, handler));
    }

    pub(crate) fn on_error(&mut self, callback: ErrorCallback) {
        self.on_error = Some(callback);
    }

    pub(crate) fn identity<T: Identity>(&mut self, port: T) {
        let port = Arc::new(port);
        self.add(
            "identity",
            "port/identity.resolve",
            Arc::new(move |params| {
                let port = Arc::clone(&port);
                Box::pin(async move {
                    let request: PortIdentityResolveParams = parse(params)?;
                    let person = port.resolve(request).await?;
                    Ok(serde_json::to_value(person).unwrap_or(Value::Null))
                })
            }),
        );
    }

    pub(crate) fn submissions<T: Submissions>(&mut self, port: T) {
        let port = Arc::new(port);
        self.add(
            "submissions",
            "port/submissions.deliver",
            Arc::new(move |params| {
                let port = Arc::clone(&port);
                Box::pin(async move {
                    let raw = serde_json::value::to_raw_value(&params)
                        .map_err(|e| PortError::new(e.to_string()))?;
                    let envelope: SubmissionEnvelope = parse(params)?;
                    Ok(port.deliver(Delivery { envelope, raw }).await?.wire())
                })
            }),
        );
    }

    pub(crate) fn drafts<T: Drafts>(&mut self, port: T) {
        let port = Arc::new(port);
        self.add(
            "drafts",
            "port/drafts.mirror",
            Arc::new(move |params| {
                let port = Arc::clone(&port);
                Box::pin(async move {
                    port.mirror(parse(params)?).await?;
                    Ok(serde_json::json!({}))
                })
            }),
        );
    }

    pub(crate) fn trusted_controls<T: TrustedControls>(&mut self, port: T) {
        let port = Arc::new(port);
        let policy = Arc::clone(&port);
        self.add(
            "trustedControls",
            "port/trustedControls.policy",
            Arc::new(move |params| {
                let port = Arc::clone(&policy);
                Box::pin(async move {
                    let request: PortTrustedControlsPolicyParams = parse(params)?;
                    let answer = port.policy(request.artifact).await?;
                    serde_json::to_value(answer).map_err(|e| PortError::new(e.to_string()))
                })
            }),
        );
        self.add(
            "trustedControls",
            "port/trustedControls.activated",
            Arc::new(move |params| {
                let port = Arc::clone(&port);
                Box::pin(async move {
                    port.activated(parse(params)?).await?;
                    Ok(serde_json::json!({}))
                })
            }),
        );
    }

    pub(crate) fn secrets<T: Secrets>(&mut self, port: T) {
        let port = Arc::new(port);
        self.add(
            "secrets",
            "port/secrets.get",
            Arc::new(move |params| {
                let port = Arc::clone(&port);
                Box::pin(async move {
                    let value = port.get(parse(params)?).await?;
                    Ok(value.map_or(Value::Null, Value::String))
                })
            }),
        );
    }
}

/// Tells the host's error callback, which can never keep the instance from its answer: a callback
/// that panics is ignored (GPT review of WP-12, finding 8).
fn report(callback: Option<&ErrorCallback>, method: &str, message: &str) {
    if let Some(callback) = callback {
        let _ =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| callback(method, message)));
    }
}

impl Incoming for PortSet {
    fn request(&self, method: String, params: Value) -> BoxFuture<'static, Result<Value, Failure>> {
        let handler = self
            .handlers
            .iter()
            .find(|(_, name, _)| *name == method)
            .map(|(_, _, handler)| Arc::clone(handler));
        let on_error = self.on_error.clone();
        Box::pin(async move {
            let Some(handler) = handler else {
                return Err(Failure::new(
                    -32601,
                    "MOSTRA_HOST_METHOD_UNKNOWN",
                    format!("This host serves no method {method}."),
                ));
            };
            // The host's own code runs in a task of its own: a panic there is a failed attempt,
            // answered at once, never a call the instance waits 30 s for.
            match tokio::spawn(handler(params)).await {
                Ok(Ok(result)) => Ok(result),
                Ok(Err(error)) => {
                    report(on_error.as_ref(), &method, error.message());
                    let code = if error.invalid_params {
                        (-32602, "MOSTRA_HOST_INVALID_PARAMS")
                    } else {
                        (-32603, "MOSTRA_HOST_INTERNAL_ERROR")
                    };
                    Err(Failure::new(
                        code.0,
                        code.1,
                        format!("{method}: {}", error.message()),
                    ))
                }
                Err(_) => {
                    report(on_error.as_ref(), &method, "the handler panicked");
                    Err(Failure::new(
                        -32603,
                        "MOSTRA_HOST_INTERNAL_ERROR",
                        format!("{method}: the host's handler panicked."),
                    ))
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::{Delivered, Incoming, PortError, PortSet, Secrets};
    use crate::wire::PortSecretsGetParams;
    use serde_json::{Value, json};

    struct Vault;

    impl Secrets for Vault {
        async fn get(&self, request: PortSecretsGetParams) -> Result<Option<String>, PortError> {
            match request.name.as_str() {
                "fails" => Err(PortError::new("invalid params: the host's own words")),
                "panics" => panic!("the host's code panicked"),
                "absent" => Ok(None),
                name => Ok(Some(format!("value of {name}"))),
            }
        }
    }

    fn ports() -> PortSet {
        let mut ports = PortSet::default();
        ports.secrets(Vault);
        ports
    }

    async fn ask(method: &str, params: Value) -> Result<Value, (i64, String)> {
        ports()
            .request(method.to_owned(), params)
            .await
            .map_err(|failure| {
                (
                    failure.code,
                    failure.diagnostic["code"]
                        .as_str()
                        .unwrap_or_default()
                        .to_owned(),
                )
            })
    }

    #[tokio::test]
    async fn a_served_port_answers_and_null_falls_back() {
        let params = json!({ "artifactId": "art_01", "name": "MAIL" });
        assert_eq!(
            ask("port/secrets.get", params).await,
            Ok(json!("value of MAIL"))
        );
        let absent = json!({ "artifactId": "art_01", "name": "absent" });
        assert_eq!(ask("port/secrets.get", absent).await, Ok(Value::Null));
    }

    #[tokio::test]
    async fn a_port_the_host_didnt_register_is_method_unknown() {
        assert_eq!(
            ask("port/addressing.externalBase", json!({})).await,
            Err((-32601, "MOSTRA_HOST_METHOD_UNKNOWN".to_owned()))
        );
    }

    #[tokio::test]
    async fn params_that_dont_read_are_invalid_params_and_the_hosts_failure_is_internal() {
        assert_eq!(
            ask("port/secrets.get", json!({ "name": 3 })).await,
            Err((-32602, "MOSTRA_HOST_INVALID_PARAMS".to_owned()))
        );
        // A host's own error is internal, whatever its message says (it once read as params).
        let fails = json!({ "artifactId": "art_01", "name": "fails" });
        assert_eq!(
            ask("port/secrets.get", fails).await,
            Err((-32603, "MOSTRA_HOST_INTERNAL_ERROR".to_owned()))
        );
    }

    #[tokio::test]
    async fn a_panicking_handler_is_answered_at_once() {
        let panics = json!({ "artifactId": "art_01", "name": "panics" });
        assert_eq!(
            ask("port/secrets.get", panics).await,
            Err((-32603, "MOSTRA_HOST_INTERNAL_ERROR".to_owned()))
        );
    }

    /// A host's error callback that panics never keeps the instance from its answer (GPT review
    /// of WP-12, finding 8).
    #[tokio::test]
    async fn a_panicking_error_callback_still_answers_at_once() {
        let mut ports = ports();
        ports.on_error(std::sync::Arc::new(|_: &str, _: &str| {
            panic!("the host's callback panicked")
        }));
        for name in ["fails", "panics"] {
            let answer = tokio::time::timeout(
                std::time::Duration::from_secs(2),
                ports.request(
                    "port/secrets.get".to_owned(),
                    json!({ "artifactId": "art_01", "name": name }),
                ),
            )
            .await
            .expect("no answer: the callback's panic took the response with it");
            let failure = answer.expect_err("a failure");
            assert_eq!(failure.code, -32603);
        }
    }

    #[test]
    fn every_delivery_answer_has_its_wire_form() {
        assert_eq!(Delivered::Accepted.wire(), json!({ "accepted": true }));
        assert_eq!(
            Delivered::Duplicate.wire(),
            json!({ "accepted": false, "reason": "duplicate", "retry": false })
        );
        assert_eq!(
            Delivered::Undeliverable.wire(),
            json!({ "accepted": false, "reason": "undeliverable", "retry": false })
        );
        assert_eq!(
            Delivered::Rejected("invalid".into()).wire(),
            json!({ "accepted": false, "reason": "invalid", "retry": false })
        );
        assert_eq!(
            Delivered::RetryLater("busy".into()).wire(),
            json!({ "accepted": false, "reason": "busy", "retry": true })
        );
    }

    /// A rejection can't pass for a delivered or undeliverable submission, and every answer has
    /// the reason the protocol needs (Opus review of WP-12, finding 4).
    #[test]
    fn a_rejection_never_takes_a_reserved_or_empty_reason() {
        for (reason, sent) in [
            ("duplicate", "rejected: duplicate"),
            (" undeliverable ", "rejected: undeliverable"),
            ("", "rejected"),
            ("  ", "rejected"),
        ] {
            assert_eq!(
                Delivered::Rejected(reason.into()).wire(),
                json!({ "accepted": false, "reason": sent, "retry": false }),
                "Rejected({reason:?})"
            );
        }
        assert_eq!(
            Delivered::RetryLater(String::new()).wire(),
            json!({ "accepted": false, "reason": "retry later", "retry": true })
        );
        // What the instance accepts: a reason of at least one character.
        for answer in [
            Delivered::Rejected(String::new()),
            Delivered::RetryLater(String::new()),
        ] {
            serde_json::from_value::<crate::wire::PortSubmissionsDeliverResult>(answer.wire())
                .map(|decoded| {
                    assert!(!matches!(
                        decoded,
                        crate::wire::PortSubmissionsDeliverResult::Unknown(_)
                    ))
                })
                .unwrap();
        }
    }
}
