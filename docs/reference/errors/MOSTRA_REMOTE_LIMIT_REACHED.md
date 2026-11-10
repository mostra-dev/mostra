---
code: MOSTRA_REMOTE_LIMIT_REACHED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REMOTE_LIMIT_REACHED

The server's limit refused this. Severity: error. Phase: host.

## What it means

The server's operator refused the operation for this account (its `limits` port): a share, a version push, a link, a view, a submission, an action or an MCP call. The message is the operator's own. A refused submission keeps its draft.

## How to fix it

Follow the operator's message; its `Retry-After`, when present, says when to try again.

## Hint

Read the message for the server's limit, and try again once it allows the operation.
