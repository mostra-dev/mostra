---
code: MOSTRA_HOST_TIMEOUT
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOST_TIMEOUT

Request timed out. Severity: error. Phase: host.

## What it means

No response arrived within the time the caller allowed. The other side may still be working on the request, and it may still take effect.

## How to fix it

Retry with the same request ID, which returns the recorded result if the first attempt completed. Allow a longer timeout for slow operations.

## Hint

Retry the request with the same request ID, or allow it more time.
