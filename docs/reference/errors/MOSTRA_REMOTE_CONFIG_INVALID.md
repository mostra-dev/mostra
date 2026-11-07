---
code: MOSTRA_REMOTE_CONFIG_INVALID
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REMOTE_CONFIG_INVALID

Remote server configuration can't be used. Severity: error. Phase: host.

## What it means

`mostra-runtime server` reads its configuration (the file `--config` names and `MOSTRA_SERVER_*` variables) before it serves anything, and stops when a key is missing, of the wrong type or out of range, naming the key. Nothing was served.

## How to fix it

Correct the key the message names: `apiOrigin` must be an `https:` origin (or `http:` on loopback), and `domains.active` a host name.

## Hint

Fix the configuration key the message names, then start mostra-runtime server again.
