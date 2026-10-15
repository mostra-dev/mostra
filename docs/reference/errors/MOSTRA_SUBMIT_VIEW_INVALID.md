---
code: MOSTRA_SUBMIT_VIEW_INVALID
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SUBMIT_VIEW_INVALID

Unknown view. Severity: error. Phase: runtime.

## What it means

Mutations and submits name the view they come from, the one the shell created when it opened this frame. The view named doesn't exist, belongs to another artifact, or belongs to another viewer. Mostra binds every submission to the exact version its view showed, so it refuses a view it can't place.

## How to fix it

Use the `viewId` the shell handed this frame. A page opened outside Mostra's shell has no view and can't submit.

## Hint

Send the view ID this page was opened with.
