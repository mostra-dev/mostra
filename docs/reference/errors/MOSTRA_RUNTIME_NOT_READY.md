---
code: MOSTRA_RUNTIME_NOT_READY
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_RUNTIME_NOT_READY

Page never became ready. Severity: error. Phase: runtime.

## What it means

The page never reported `mostra/ready`: the client runtime didn't mount it within the time verify allows, usually because the entry threw while loading or a module failed to load.

## How to fix it

Fix the load error the other diagnostics report. A page that waits for data should render a loading state first.

## Hint

Make sure the entry's default export renders; check the other diagnostics for an error at load.
