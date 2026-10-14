---
code: MOSTRA_ENV_SHELL_MISSING
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ENV_SHELL_MISSING

Shell app missing. Severity: error. Phase: host.

## What it means

Viewers open artifacts inside the shell, Mostra's trusted page, which ships with the runtime as built files. The runtime couldn't find them, which means the runtime installation is incomplete. Artifact frames are still served.

## How to fix it

Reinstall Mostra so the runtime bundle is complete. A custom layout can point the runtime at the shell's built directory with `MOSTRA_SHELL_DIR`.

## Hint

Reinstall the Mostra runtime, or set `MOSTRA_SHELL_DIR` to its built shell.
