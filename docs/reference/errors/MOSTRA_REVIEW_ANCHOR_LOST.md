---
code: MOSTRA_REVIEW_ANCHOR_LOST
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REVIEW_ANCHOR_LOST

Anchor not found for its crop. Severity: error. Phase: host.

## What it means

Capturing a thread's crop, no layer of its anchor found its place in the page: the element is gone or moved past its selectors, and the anchor had no box to fall back on.

## How to fix it

Add `data-review-id` to elements people comment on.

## Hint

Give the element a `data-review-id`, so comments find it again in any version.
