---
code: MOSTRA_LIVE_TOO_LARGE
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_LIVE_TOO_LARGE

Live value too large. Severity: error. Phase: runtime.

## What it means

A live value, pushed or produced, is over 4 MiB once serialized (DATA_MODEL §5). It is refused and the last good value stays.

## How to fix it

Send a smaller window of the data, or split it across several live sources. For high-rate series, push single points in append mode and let the page keep the window.

## Hint

Push or produce a smaller value: at most 4 MiB serialized.
