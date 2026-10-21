# mostra-host

Host [Mostra](https://github.com/mostra-dev/mostra), the agent artifact runtime, from Rust.
Agents write ordinary React; Mostra turns it into stateful, interactive web artifacts that people
view, answer and act on, and hands the answers to your host.

```rust,no_run
use mostra_host::ports::{Delivered, Delivery, PortError, Submissions};
use mostra_host::{Mostra, Options, PublishOptions, WaitOptions};

struct Inbox;

impl Submissions for Inbox {
    async fn deliver(&self, delivery: Delivery) -> Result<Delivered, PortError> {
        // Store delivery.raw, keyed by delivery.envelope.delivery_id (idempotently).
        Ok(Delivered::Accepted)
    }
}

# async fn run() -> mostra_host::Result<()> {
let mostra = Mostra::spawn(
    Options::new("/var/lib/my-host/mostra")
        .client("my-host", "1.0.0")
        .submissions(Inbox),
)
.await?;
let receipt = mostra.publish("/work/questions", PublishOptions::default()).await?;
println!("open {}", receipt.url.as_deref().unwrap_or_default());
mostra.wait(receipt.artifact_id.as_str(), "submitted", WaitOptions::default()).await?;
let results = mostra.results(receipt.artifact_id.as_str(), None).await?;
mostra.close().await?;
# Ok(()) }
```

- **Spawn or attach.** `Mostra::spawn` runs your own instance over stdio for as long as the
  handle lives; `Mostra::attach` reaches the home's daemon over its socket and starts it when
  none runs.
- **Typed protocol.** Every method and type of the host protocol, generated from the protocol's
  JSON Schema. Values a newer Mostra adds (an enum value, a union member, a field) are kept, never
  refused.
- **Ports.** Implement `Submissions`, `Drafts`, `Identity`, `TrustedControls` and `Secrets` with
  ordinary `async fn`s; Mostra calls them on your connection.
- **No Node.js to install.** The crate downloads the runtime bundle its release pins, checks every
  byte against the pins and caches it by digest, shared with the TypeScript SDK.

macOS and glibc Linux on arm64 and x64. The crate sends no telemetry. Apache-2.0.
