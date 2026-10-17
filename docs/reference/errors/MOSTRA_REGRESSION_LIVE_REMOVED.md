---
code: MOSTRA_REGRESSION_LIVE_REMOVED
severity: warning
phase: contract
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REGRESSION_LIVE_REMOVED

Live source gone since the last passing version. Severity: warning. Phase: contract.

## What it means

A live source (`live.ts` export) the last passing version had is gone, so its producer stops and hosts that push to it push to a key no page reads.

## How to fix it

If it was renamed by mistake, keep its name. If it was removed on purpose, nothing needs to change.

## Hint

Observed only: the last passing version had this live source and this source doesn't; one removed on purpose needs nothing more.
