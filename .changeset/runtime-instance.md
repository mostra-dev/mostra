---
"@mostra/runtime": minor
---

First release of `@mostra/runtime`: the supervisor that owns a Mostra home. `mostra-runtime host`
serves the host protocol over stdio and `mostra-runtime daemon` over the home's socket, with
`mostra/initialize` negotiation, `instance/status` and `mostra/shutdown`. A home's owner holds the
ledger's exclusive lock, so racing starters converge on one supervisor and attach to it through
`instance.json`; the ledger runs SQLite in WAL mode with `synchronous=FULL`, migrations with a
backup, and fails closed when its file disappears. Every child runs in its own process group, is
recorded with its PID and start time, and is reaped after a crash. macOS and Linux only; other
platforms fail closed with `MOSTRA_PLATFORM_UNSUPPORTED`.
