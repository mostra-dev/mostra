---
code: MOSTRA_REVIEW_CROP_MISSING
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REVIEW_CROP_MISSING

No crop for this thread. Severity: error. Phase: host.

## What it means

The thread's crop isn't captured: it is still being captured, or its capture failed (the thread says why).

## How to fix it

Read the crop again once the thread's crop state is `captured`.

## Hint

Wait for the crop, or read the thread's other anchor layers.
