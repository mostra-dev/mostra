---
code: MOSTRA_SMOKE_BUDGET
severity: hint
phase: smoke
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SMOKE_BUDGET

Smoke test stopped at its budget. Severity: hint. Phase: smoke.

## What it means

The page has more controls than the smoke test uses in one run, so it stopped at its budget. The controls it used are counted in `smoke.interactions`.

## How to fix it

Nothing is required.

## Hint

Nothing to fix: the smoke test stops after 200 interactions or 60 s.
