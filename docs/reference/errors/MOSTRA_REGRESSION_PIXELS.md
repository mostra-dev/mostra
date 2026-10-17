---
code: MOSTRA_REGRESSION_PIXELS
severity: warning
phase: regression
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REGRESSION_PIXELS

Page looks different from the last passing version. Severity: warning. Phase: regression.

## What it means

Verify rendered the newest version whose verdict passed and this source at the same viewport, clock and data, and the share of pixels the message gives differs between them. Any intended visual change shows here too.

## How to fix it

If the change is one you made on purpose, nothing needs to change. To see where it is, read the ARIA snapshots, or look at the diff image the message names if you can view images.

## Hint

Observed only: this share of the viewport's pixels differs from the last passing version; an intended visual change shows here too and needs nothing more.
