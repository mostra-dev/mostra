---
code: MOSTRA_SUBMIT_PAUSED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SUBMIT_PAUSED

Artifact paused, no answers taken. Severity: error. Phase: host.

## What it means

The artifact is paused (`mostra pause`, or its server's operator paused it). A paused artifact stays viewable and its links stay valid, but it takes no submissions until it is resumed. Nothing was recorded, and the draft stays as it was.

## How to fix it

The owner resumes it with `mostra resume <artifact>`; a pause by the server's operator is resumed only by the operator.

## Hint

Wait until the page is resumed, then submit again; the draft is kept.
