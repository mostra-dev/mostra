---
code: MOSTRA_REMOTE_HOME_MOVING
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REMOTE_HOME_MOVING

This account's pages are moving. Severity: error. Phase: host.

## What it means

The server's operator is moving this account's hosted home to another data directory (`drainHome`), so the home is closed here until it serves again. Clients retry; nothing is lost.

## How to fix it

Retry shortly; the move ends when the operator releases the home on its new machine.

## Hint

Try again in a minute: this account's pages are moving between machines.
