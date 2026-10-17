---
code: MOSTRA_SECRET_MISSING
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SECRET_MISSING

Secret not set. Severity: error. Phase: runtime.

## What it means

Server code called `secret(name)` for a secret that neither the host's `secrets` port, the artifact's own secrets nor the home's shared secrets hold (D44). The call throws, and an action run fails with this code.

## How to fix it

Set the secret for the artifact (`mostra secret set NAME --artifact <path|id>`) or for every artifact of the home (`mostra secret set NAME`), passing the value on stdin, then run the action again. Secret values never go into the artifact's source.

## Hint

Set the secret with `mostra secret set NAME`, reading the value from stdin.
