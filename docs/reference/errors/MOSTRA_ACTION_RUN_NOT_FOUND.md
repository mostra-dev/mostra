---
code: MOSTRA_ACTION_RUN_NOT_FOUND
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ACTION_RUN_NOT_FOUND

No such action run. Severity: error. Phase: runtime.

## What it means

A page asked for or cancelled an action run that this artifact doesn't have, or one started from another artifact.

## How to fix it

Use the run IDs `useAction` reports. A page that keeps run IDs itself should drop IDs from other artifacts.

## Hint

Start the action again; the run ID names no run of this artifact.
