---
code: MOSTRA_ENV_RUNTIME_MISSING
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ENV_RUNTIME_MISSING

Runtime not found. Severity: error. Phase: host.

## What it means

The CLI starts and attaches to the home's instance through the runtime binary (`mostra-runtime`, D85). It looked for it at `MOSTRA_RUNTIME_BIN`, then beside the CLI, and found nothing it could run.

## How to fix it

Reinstall Mostra so the CLI and its runtime are complete, or point `MOSTRA_RUNTIME_BIN` at a `mostra-runtime` entry (its `dist/bin.js`).

## Hint

Reinstall Mostra, or set `MOSTRA_RUNTIME_BIN` to the runtime's `mostra-runtime` entry.
