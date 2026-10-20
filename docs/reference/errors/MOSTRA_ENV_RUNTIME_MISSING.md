---
code: MOSTRA_ENV_RUNTIME_MISSING
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ENV_RUNTIME_MISSING

Runtime not found. Severity: error. Phase: host.

## What it means

The CLI starts and attaches to the home's instance through the runtime binary (`mostra-runtime`, D85). It looked, in order, for `MOSTRA_BUNDLE`, `MOSTRA_RUNTIME_BIN`, the runtime bundle it runs from, its release's pinned bundle and a development checkout's built runtime (D142), and found nothing it could run: here, `MOSTRA_RUNTIME_BIN` names a file that doesn't exist, or the runtime couldn't be started.

## How to fix it

Unset `MOSTRA_RUNTIME_BIN` or point it at a `mostra-runtime` entry (its `dist/bin.js`), or reinstall Mostra so the CLI and its runtime are complete.

## Hint

Reinstall Mostra, or set `MOSTRA_RUNTIME_BIN` to the runtime's `mostra-runtime` entry.
