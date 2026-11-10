---
code: MOSTRA_REMOTE_OPERATOR_UNAVAILABLE
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REMOTE_OPERATOR_UNAVAILABLE

The server's operator didn't answer. Severity: error. Phase: host.

## What it means

The server's operator module didn't answer in time (2 s for limits, 5 s for sign-in), so an operation that creates something (a share, a push, a link, authoring, a sign-in) was refused rather than allowed blind. Views, drafts and submissions never wait for it, and existing sessions keep working.

## How to fix it

Try again; if it lasts, the server's operator has to fix its operator module.

## Hint

Try again in a moment; the server's operator didn't answer in time.
