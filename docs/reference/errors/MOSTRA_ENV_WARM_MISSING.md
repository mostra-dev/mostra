---
code: MOSTRA_ENV_WARM_MISSING
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ENV_WARM_MISSING

Warm package set missing. Severity: error. Phase: host.

## What it means

Builds resolve React, Tailwind and Mostra's own client packages from the warm package set that ships with the runtime. The runtime couldn't find it, which means the runtime installation is incomplete.

## How to fix it

Reinstall Mostra so the runtime bundle is complete. A custom layout can point the runtime at the warm set's directory with `MOSTRA_WARM_DIR`.

## Hint

Reinstall the Mostra runtime, or set `MOSTRA_WARM_DIR` to its warm package set.
