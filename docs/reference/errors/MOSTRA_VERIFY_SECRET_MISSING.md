---
code: MOSTRA_VERIFY_SECRET_MISSING
severity: warning
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_VERIFY_SECRET_MISSING

Secret missing during verify. Severity: warning. Phase: runtime.

## What it means

Server code asked for a secret (`secret()`) that neither the host, the artifact's secrets nor the home's hold, while verify ran it. Secrets are part of the environment, so verify reports this as a warning rather than an error.

## How to fix it

Run `mostra secret set <NAME>` (for the artifact or the home) with the value the code needs, then verify again.

## Hint

Set the secret with `mostra secret set <NAME>` if the artifact needs it; verify reports it as the environment, not the code.
