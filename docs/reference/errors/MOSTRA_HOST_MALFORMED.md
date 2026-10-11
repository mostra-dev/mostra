---
code: MOSTRA_HOST_MALFORMED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOST_MALFORMED

Malformed protocol message. Severity: error. Phase: host.

## What it means

Every message on a Mostra connection is one line of JSON with one JSON-RPC 2.0 object. This code means a line wasn't valid JSON, wasn't a JSON-RPC 2.0 request or response, or was a batch (a JSON array), which revision `2026-10-10` doesn't accept. A client also reports it when a response doesn't match the method's result schema.

## How to fix it

Encode one request per line with `"jsonrpc": "2.0"`, a `method`, an `id` for requests, and `params` as an object. Send several requests as separate lines instead of a batch.

## Hint

Send each message as one line of JSON holding a single JSON-RPC 2.0 request or notification.
