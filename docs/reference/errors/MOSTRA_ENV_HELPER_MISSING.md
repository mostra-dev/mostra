---
code: MOSTRA_ENV_HELPER_MISSING
severity: error
phase: platform
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ENV_HELPER_MISSING

Windows helper missing. Severity: error. Phase: platform.

## What it means

On Windows the runtime runs `mostra-win.exe`, a helper that ships with it, for what Node.js can't do there: owner-only access to the home, the home's control pipe, and every child process in a Job Object. The runtime looked for it at `MOSTRA_WIN_HELPER`, in its runtime bundle, and in a development checkout's Cargo build, and found none, so it stopped before touching the home.

## How to fix it

Reinstall Mostra so the runtime bundle is complete. In a development checkout, build the helper with `cargo build -p mostra-win`. A custom layout can point the runtime at the helper with `MOSTRA_WIN_HELPER`.

## Hint

Reinstall Mostra, or set `MOSTRA_WIN_HELPER` to its `mostra-win.exe`.
