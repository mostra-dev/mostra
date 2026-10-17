---
code: MOSTRA_REGRESSION_ARIA
severity: warning
phase: regression
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REGRESSION_ARIA

Controls or landmarks gone since the last passing version. Severity: warning. Phase: regression.

## What it means

Verify compared this source's accessibility snapshot with the newest version whose verdict passed, rendered in the same run with the same data. The controls or landmarks the message lists (by role and name) were there and aren't now. A redesign may remove them on purpose.

## How to fix it

If they should be gone, nothing needs to change. If not, look at what removed them.

## Hint

Observed only: the last passing version had these controls or landmarks and this source doesn't; check that this is intended.
