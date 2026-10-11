---
code: MOSTRA_HOST_CONNECTION_CLOSED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOST_CONNECTION_CLOSED

Connection closed. Severity: error. Phase: host.

## What it means

The connection to the other side closed before a response arrived, for example because the instance exited or restarted. The request may or may not have taken effect.

## How to fix it

Reconnect and send `mostra/initialize` again, then retry the request with the same request ID. Mutating methods are idempotent by request ID, so a retry never applies twice.

## Hint

Reconnect, then retry the request with the same request ID.
