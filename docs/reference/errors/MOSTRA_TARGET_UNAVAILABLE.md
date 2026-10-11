---
code: MOSTRA_TARGET_UNAVAILABLE
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_TARGET_UNAVAILABLE

Not available in this delivery target. Severity: error. Phase: runtime.

## What it means

The page called something that needs Mostra's server, such as a server function, and this delivery target doesn't provide it: a static export, a file opened from disk, or a runtime without server support. The page keeps working without it.

## How to fix it

Open the artifact through its Mostra link, where server functions, submissions and live data are available. In a static export, handle the error so the page explains what isn't available.

## Hint

Open the published version through Mostra to use this feature.
