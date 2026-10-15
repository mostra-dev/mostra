---
code: MOSTRA_SUBMIT_REVISION_MOVED
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SUBMIT_REVISION_MOVED

Draft changed before submit. Severity: error. Phase: runtime.

## What it means

A submit names the draft revision the viewer saw (`expectedRevision`), and the draft has changed since: another tab, device or writer saved an edit. Mostra never makes a submission from content the viewer didn't see (FAILURE_MODEL §4), so it refuses. The message names the draft's current revision.

## How to fix it

Let the page reload the draft so the viewer sees exactly what will be sent, then submit with the new revision. The shell and the client runtime flush pending saves before they submit, which makes this rare.

## Hint

Reload the draft, check what changed, and submit again with its current revision.
