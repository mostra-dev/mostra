# Jcode as a Mostra host

**Purpose.** Jcode is Mostra's first known host. C03-A designs Mostra so that C03-B can integrate Jcode **without changing Mostra** (D01). This brief gives a toolkit designer enough Jcode context to get the ports right. Everything Jcode needs here must be met by **generic** Mostra mechanisms. Nothing Jcode-specific belongs in Mostra's core (invariant 11 in [PRODUCT.md](PRODUCT.md#rule-strengths)).

**Status of the facts.** These are observations from Mirza's approved Jcode program documents as of 2026-10-10:
- the SP-58 parent (P12 to P14 and the C03 section);
- the approved SP-58-C02 design (decisions R1-xx to R6-xx, requirement R26, work packages WP-06 and WP-10).

C02 was being implemented when this was written (WP-01 accepted, WP-02 in progress), so names and shapes can still move. C03-B re-verifies them against Jcode's source. C03-A uses them to shape ports, not as an interface to code against.

## Jcode in one page

- **What it is.** Jcode is Mirza's personalized fork of an open-source Rust coding-agent harness (TUI and CLI). A long-lived per-user server runtime hosts **primary sessions** that keep running when no terminal client is attached. On Mirza's machine it runs as a macOS login service.
- **Trusted clients.** Same-user authenticated connections such as the TUI and Harness/SDK clients can act with human authority. Agent tool arguments never confer an answer, approval or launch.
- **Durable input.** Human answers reach a session through a durable input path. The session may be busy, idle, waiting on a declared stop, manually stopped, or temporarily unavailable during restart.
- **Public contracts.** C02 adds `session_work_v1` (inspect, list waiting items, answer, **artifact draft and submit**, proposal decisions, dispositions, timing) and `attention_stream_v1` over Harness and the Rust and TypeScript SDKs. Requests are idempotent and errors are typed.
- **Remote use.** Mirza works from other devices through his own tunnel.

## The artifact contract Jcode already approved (C02)

From C02 decision R2-29, requirement R26 and WP-06:
- **A generic artifact interaction kind** with a **family name**, an **opaque payload** and **server-side drafts that are never delivered**. Jcode never interprets the payload, so Mostra's submission content is that payload.
- **Exactly one submission** per artifact interaction. There are **no revisions** and **no withdrawal**. Multi-round work means separate artifacts.
- **The same arrival, hold and wait rules as other items.** Artifacts get a per-session alias (`a1`, `a2` and so on). The agent can declare a wait on them, and the default wait limit for a questionnaire or artifact is 24 hours. A timeout never kills work.
- **Only trusted clients submit artifacts.** Each answer records its **channel**.
- **Client request IDs make operations idempotent.** A client retries a submission with the same request ID during runtime downtime, and the retries converge.
- **Delivery.** A submission is delivered to the owning session as a human arrival under C02's arrival rules:
  - a busy session gets it at a safe boundary;
  - a waiting session wakes;
  - a manually stopped session resumes;
  - an unavailable runtime keeps it for later delivery;
  - a session that no longer exists gets a visible, terminal "undeliverable" state.
- **No agent-facing questionnaire tool in C02.** C03-B adds the agent-facing tools.

From the SP-58 parent (P12 to P14):
- **Publication returns an immediate durable receipt or ID.** The agent continues working or declares a wait on it separately. Publication is never an implicit stop.
- **Submission notifies the agent.** The agent then reads **complete results through a standardized read interface**. The notification is not the answer payload.
- **These are different facts:** durable receipt, UI notification, agent input delivery and agent consumption.
- **A draft is not a submitted answer.** Approval must never apply to content other than what was presented.
- **Presentation is not evidence of approval.** Rendered agent content never gains host authorization.
- **No stranded tools.** An agent-facing tool is never advertised while its human answer path is missing.

From the parent's C03 section, obligations C03 as a whole must meet:
- Complete retained-artifact and answer access after sessions or checkouts close.
- Distinguish the original publication, the submitted answers and what the agent actually consumed.
- Handle local and remote addressing, browser and client identity, origin isolation, trusted controls, filesystem access, credentials, external asset dependencies and privacy.
- Public hosting is never implicit.
- Pass revise, retry, restart and stale-client cases. Presentation leaves the agent free to continue.
- Validate with realistic multi-round forms and visual candidates suitable for C04's TUI design work. C04 uses C03 to present its prototypes.

## What Mostra must provide (generic requirements)

Each row is a generic Mostra capability that the Jcode integration relies on. C03-A designs them for every host. The right column shows how C03-B is expected to use them.

| ID | Mostra capability | Jcode use (C03-B) | Mostra requirements |
|---|---|---|---|
| H-01 | Host-owned drafts and submissions through the drafts and submissions ports | Jcode implements the ports over `session_work_v1` artifact draft and submit, so Jcode's store holds the authoritative drafts and the single submission | HO-01, IN-01, IN-05 |
| H-02 | Submission policy `once` with a conflict reply on a second submit | Matches R26 | IN-07 |
| H-03 | Stable submission and mutation IDs usable as host request IDs; idempotent retries | Mostra's IDs become Jcode client request IDs | IN-01, IN-05, HO-05 |
| H-04 | Local outbox with idempotent replay while the host is unreachable | The submission survives a Jcode server restart or reload; Jcode later delivers it | IN-12 |
| H-05 | Trusted controls in the shell origin; artifact-rendered submit can be disabled per host; submission carries channel and viewer identity metadata | Jcode accepts only shell submissions and records the channel (for example "Mostra shell, tailnet user X") | SH-01, SH-02, HO-01 |
| H-06 | Free-form artifact metadata including a `family` label and links to related artifacts | Maps to C02's family name and multi-round linkage | AU-04 |
| H-07 | Publish returns artifact ID, version ID and capability URL synchronously and durably | Jcode creates its artifact interaction (alias `aN`) and returns an immediate receipt | VR-01, VR-02 |
| H-08 | `results` through the host protocol, returning the complete submission (snapshot, choices, comments with crops, version IDs) | C03-B's agent-facing read tool; the notification stays small | IN-11 |
| H-09 | An event log with host-side filters; signals are events | Jcode maps only Submit to an arrival in its first integration; other events stay readable without waking the agent | IN-08, IN-09 |
| H-10 | Submissions name exact version and view; stale-view submissions are flagged with the version they name | Approval applies only to presented content | IN-05 |
| H-11 | Host-configurable storage locations outside any project checkout; artifacts, versions and submissions remain readable after the originating directory is removed | Answers and artifacts survive Jcode checkout closeout | HO-08 |
| H-12 | Process models: spawned over stdio by a long-lived host, or a standalone daemon a host attaches to | Jcode's server spawns or attaches to Mostra independently of TUI connections | RT-06 |
| H-13 | A Rust host crate (tokio-friendly) and a runtime bundle the host downloads and caches by hash | Jcode is Rust; its install channels manage the bundle | HO-03, RT-01 |
| H-14 | Addressing port with tunnel hostnames and capability minting | Links work from Mirza's other devices; C04's TUI shows them | HY-04, HO-10 |
| H-15 | A host conformance kit | C03-B proves the Jcode adapter against it | HO-05 |
| H-16 | No telemetry in host-embedded instances (D119); private, owner-only storage in the standalone adapters | Matches Jcode's privacy rules | EN-08 |

## What stays with C03-B, not Mostra

- Jcode's agent-facing tools: publishing an artifact as an interaction, reading results, and their names, descriptions and activation behind Jcode's staged-activation rule.
- Mapping Mostra submissions into C02's arrivals, aliases, waits and attention events.
- Placing the Mostra process inside Jcode's runtime ownership: spawn or attach, restart reconciliation and shutdown.
- Packaging the Mostra runtime bundle with Jcode's install channels.
- Links and status in Jcode's TUI, which C04 consumes.
- Any change to C02's contract. A gap found later is fixed at C02's owner, not worked around in Mostra.

## Questions for C03-B (recorded, not for C03-A to settle)

- Spawn versus attach as Jcode's default process model, and how Jcode reconciles Mostra after a reload.
- Where Jcode agents author artifact sources: the session's checkout, Mostra's home or a Jcode-managed directory.
- Whether Jcode later wants non-terminal signals (for example "ping agent") as arrivals. That would extend C02's contract at its owner. The first integration maps Submit only.
- The agent-facing tool names and their framework-stage descriptions, authored jointly with Mirza.

## How Mostra meets each need

Added by the C03-A design. Every row is a generic mechanism; none names Jcode in Mostra's code (HO-06).

| ID | Generic mechanism in the settled design |
|---|---|
| H-01 | Mostra's ledger stays canonical (D58); the host's `submissions.deliver` port receives the complete submission as an opaque envelope, and the optional `drafts.mirror` port receives each draft revision |
| H-02 | Policy `once` with scope `per-artifact`; a second submit returns `MOSTRA_SUBMIT_ALREADY` with the existing submission (FAILURE_MODEL §4) |
| H-03 | Every mutating protocol method takes `requestId`; submissions carry stable `submissionId` and `deliveryId`; redelivery after a crash reuses them |
| H-04 | Outbox: deliveries stay `pending` while the host is down, retry with backoff, and replay in order when the host re-registers the port; `HomeConfig.ports` tells Mostra a host is expected |
| H-05 | `trustedControls.policy` returns `submitChannels: ["shell"]`; submissions record `channel` and `viewer` (from the `identity` port) |
| H-06 | Manifest `family` and `links` (INTERFACES §2.2), returned in `artifact/get` and `results` |
| H-07 | `artifact/publish` returns a durable `PublishReceipt` (artifact ID, version ID, number, URL, cursor) |
| H-08 | `results/get` returns the complete Results structure (INTERFACES §8) as JSON or Markdown |
| H-09 | `events/subscribe` with a type filter (for example `submission.created` only) and a durable acknowledged cursor; signals are events |
| H-10 | Submissions carry `versionId`, `viewId` and `staleView` |
| H-11 | The host chooses the home (`HomeConfig.home`); versions keep source snapshots in the home (DATA_MODEL §1) |
| H-12 | `mostra host` over stdio, or attach to the home's daemon over its socket (D45) |
| H-13 | Rust crate `mostra-host` with a tokio client, port traits and runtime-bundle download and cache by hash |
| H-14 | `addressing.externalBase`, `share/start` and capability minting through `view/url` |
| H-15 | `@mostra/conformance` runs against the host's adapter, with expected-failure baselines |
| H-16 | No telemetry in host-embedded instances (D119): a host-spawned instance, the SDK, the Rust crate and every home a host configures send nothing; homes are created 0700 and secrets 0600 |
