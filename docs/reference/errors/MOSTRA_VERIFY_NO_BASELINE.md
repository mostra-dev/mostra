---
code: MOSTRA_VERIFY_NO_BASELINE
severity: hint
phase: regression
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_VERIFY_NO_BASELINE

No earlier passing version. Severity: hint. Phase: regression.

## What it means

Verify compares a source with the newest published version of its artifact whose verdict passed. This artifact has none yet (it is new, or every earlier version was published with `--force`), so no regression stage ran.

## How to fix it

Nothing is required.

## Hint

Nothing to fix: the next version will be compared with this one once it is published.
