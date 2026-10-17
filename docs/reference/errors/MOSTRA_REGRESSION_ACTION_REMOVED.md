---
code: MOSTRA_REGRESSION_ACTION_REMOVED
severity: warning
phase: contract
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REGRESSION_ACTION_REMOVED

Server function gone since the last passing version. Severity: warning. Phase: contract.

## What it means

A `"use server"` export the last passing version had is gone. Pages of the older version still call it while they are open, and keyed runs started by it can't be started again.

## How to fix it

If it was renamed by mistake, keep its name. If it was removed on purpose, nothing needs to change.

## Hint

Observed only: the last passing version had this server function and this source doesn't; check that this is intended.
