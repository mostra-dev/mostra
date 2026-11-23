---
code: MOSTRA_REVIEW_ANCHOR_TOO_LARGE
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REVIEW_ANCHOR_TOO_LARGE

Anchor too large. Severity: error. Phase: host.

## What it means

A comment's anchor, with every layer it holds, was larger than an anchor may be (32 KiB of JSON).

## How to fix it

Keep anchor provider data small: name the datum, not the dataset.

## Hint

Anchor to a smaller element, or keep an anchor provider's data under 16 KiB.
