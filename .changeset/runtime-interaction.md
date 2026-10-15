---
"@mostra/runtime": minor
---

The interaction ledger (WP-06): drafts and artifact state with per-field compare-and-set and replayable mutation IDs; the submit transaction under `once`, `epochs` and `none`, with write-once submissions bound to the exact version and view; the outbox delivering to hosts' `submissions` ports in order, with backoff and redelivery by `deliveryId`, and draft mirrors; events with filters, durable subscriptions, acknowledgments and compaction; signals; `wait`; results as JSON and Markdown; the host methods `state/get`, `state/patch`, `results/get`, `wait` and `events/*`; and the browser protocol's first revision, `2026-10-15` (`fields`, `submit`, `signal`, `events`, `events/poll`). `view/url` takes a `viewer`, frame tickets record a view, and `HomeConfig` takes `submission` and `ports`.
