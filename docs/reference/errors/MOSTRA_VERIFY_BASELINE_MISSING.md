---
code: MOSTRA_VERIFY_BASELINE_MISSING
severity: hint
phase: regression
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_VERIFY_BASELINE_MISSING

Baseline version's build is missing. Severity: hint. Phase: regression.

## What it means

The newest version that passed verify is recorded in the ledger, but its stored build isn't in the home any more, so verify couldn't render it and ran no regression stage.

## How to fix it

Nothing is required. A version published from this source becomes the next baseline.

## Hint

Nothing to fix here; publish again to give later versions a baseline.
