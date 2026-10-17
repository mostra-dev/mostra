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

Look at both screenshots. If the difference is intended, nothing needs to change.

## Hint

Observed only: this viewport looks different from the last passing version; compare the two screenshots before changing anything.
