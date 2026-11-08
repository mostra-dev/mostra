---
code: MOSTRA_REMOTE_PAUSED_BY_OPERATOR
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REMOTE_PAUSED_BY_OPERATOR

Paused by the server's operator. Severity: error. Phase: host.

## What it means

The server's operator paused this hosted artifact, and an owner can't undo an operator's pause (D165 item 14). Views keep working and the links stay valid.

## How to fix it

Ask the server's operator why it was paused and to resume it.

## Hint

Contact the server's operator: only the operator resumes a pause it made.
