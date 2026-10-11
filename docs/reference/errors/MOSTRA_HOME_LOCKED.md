---
code: MOSTRA_HOME_LOCKED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOME_LOCKED

Home in use by another instance. Severity: error. Phase: host.

## What it means

One Mostra instance owns a home at a time. It holds an exclusive lock on the home's ledger, and the operating system releases that lock when the process exits. Mostra reports this code in two cases: `mostra host` was started for a home another instance already owns, or a starter found the owner but couldn't reach its control socket. The message names the owner's process ID.

## How to fix it

To share the running instance, attach to it: start the client with the same home (`MOSTRA_HOME` or `--home`) instead of starting a second instance. To replace it, stop it with `mostra daemon stop`, or end the process named in the message, and start again. A host that needs its own instance gives it its own home.

## Hint

Use the instance that already owns this home, or stop it (`mostra daemon stop`, or end the process named in the message) and start again.
