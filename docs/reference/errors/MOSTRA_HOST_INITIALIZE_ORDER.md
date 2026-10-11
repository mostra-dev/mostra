---
code: MOSTRA_HOST_INITIALIZE_ORDER
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOST_INITIALIZE_ORDER

Initialize first, and only once. Severity: error. Phase: host.

## What it means

Every connection starts with `mostra/initialize`, which agrees the protocol revision and registers the client's ports. The instance received another request before it, or a second `mostra/initialize` on the same connection.

## How to fix it

Send `mostra/initialize` first and wait for its result before any other request. To renegotiate, open a new connection.

## Hint

Send `mostra/initialize` as the first request on the connection, and only once.
