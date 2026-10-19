---
code: MOSTRA_ENV_BUNDLE_UNAVAILABLE
severity: error
phase: platform
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ENV_BUNDLE_UNAVAILABLE

No runtime bundle available. Severity: error. Phase: platform.

## What it means

Mostra runs on its own runtime bundle, found in the local cache, beside the installed package or at `MOSTRA_BUNDLE`. None was there, and no download could start: Mostra is offline (`MOSTRA_OFFLINE`), this build of the package pins no bundle for this platform, or the platform has none.

## How to fix it

Run the command once with network access and without `MOSTRA_OFFLINE`, so the pinned bundle is fetched and cached; later runs work offline. On a machine without network access, extract the release's archive for the platform and set `MOSTRA_BUNDLE` to its directory. A development checkout uses its own built runtime instead.

## Hint

Run this once with network access, or point `MOSTRA_BUNDLE` at an extracted bundle.
