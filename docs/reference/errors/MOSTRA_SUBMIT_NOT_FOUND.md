---
code: MOSTRA_SUBMIT_NOT_FOUND
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SUBMIT_NOT_FOUND

No such submission. Severity: error. Phase: runtime.

## What it means

The artifact has no submission yet, or none with the ID asked for. Submissions are durable once made, so this means none was made (or the ID belongs to another artifact or home).

## How to fix it

Run `mostra wait <artifact> --until submitted` to block until the viewer submits, then read the results. List the artifact's submissions through `submission.created` events.

## Hint

Wait for a submission with `mostra wait --until submitted`, or name one that exists.
