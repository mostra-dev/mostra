---
code: MOSTRA_ACTION_PAUSED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ACTION_PAUSED

Artifact paused, no actions run. Severity: error. Phase: host.

## What it means

The artifact is paused, so its actions don't run: the run or call was refused before anything was recorded or sent to the owner's machine.

## How to fix it

The owner resumes it with `mostra resume <artifact>`; a pause by the server's operator is resumed only by the operator.

## Hint

Wait until the page is resumed, then run the action again.
