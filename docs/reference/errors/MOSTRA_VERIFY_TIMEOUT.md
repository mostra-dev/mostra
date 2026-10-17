---
code: MOSTRA_VERIFY_TIMEOUT
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_VERIFY_TIMEOUT

Verify ran out of time. Severity: error. Phase: runtime.

## What it means

Verify allows 120 s for everything after the build: booting the sandbox, rendering each viewport, the smoke test and the regression stage. This run went past it, so its verdict is partial: the message names the stage it reached. A partial run can't vouch for the page, so this is an error, and the verdict isn't cached.

## How to fix it

Look for work the page does at load that takes long (large data, long animations, requests that never answer) and defer it, then verify again. On a heavily loaded machine, verifying again may be enough.

## Hint

Make the page render without waiting on slow work at load, then verify again.
