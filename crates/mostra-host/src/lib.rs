//! Host Mostra, the agent artifact runtime, from Rust (HO-03, D25, D59).
//!
//! Mostra turns ordinary React into stateful, interactive web artifacts that people view, answer
//! and act on. A host (an agent harness, an application) embeds it through this crate: it spawns
//! the host's own instance or attaches to the home's daemon, speaks the versioned host protocol,
//! and serves the ports through which Mostra hands the host what it needs: submissions as they
//! become durable, draft mirrors, who a viewer is, which controls a view shows, secrets.
//!
//! - [`Mostra`] is the session: [`Mostra::spawn`] or [`Mostra::attach`], then typed calls
//!   ([`Mostra::call`] for any method of [`wire::methods`], helpers for the common ones) and
//!   [`Mostra::events`].
//! - [`ports`] holds the port traits a host implements with `async fn`s.
//! - [`wire`] holds the protocol's types, generated from `@mostra/protocol`'s schema.
//! - [`runtime`] and [`bundle`] find, download, verify and cache the runtime bundle a release
//!   pins, so no Node.js needs to be installed.
//!
//! Every failure is an [`Error`] with a stable diagnostic code. This crate sends no telemetry,
//! and the instances it spawns are host instances, which send none either (D119).

pub mod bundle;
mod download;
mod error;
pub mod events;
mod mostra;
pub mod ports;
mod rpc;
pub mod runtime;
pub mod wire;

pub use error::{Error, Result};
pub use events::{EventPage, EventStream, EventStreamOptions};
pub use mostra::{InstanceExit, Mostra, Options, PublishOptions, REVISIONS, Target, WaitOptions};
