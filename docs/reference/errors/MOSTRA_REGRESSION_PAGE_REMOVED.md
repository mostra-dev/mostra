---
code: MOSTRA_REGRESSION_PAGE_REMOVED
severity: warning
phase: contract
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REGRESSION_PAGE_REMOVED

Page route gone since the last passing version. Severity: warning. Phase: contract.

## What it means

A route of `pages/` the last passing version had is gone, so links and bookmarks to it now open the artifact's fallback page.

## How to fix it

If it was renamed by mistake, keep its path. If it was removed on purpose, nothing needs to change.

## Hint

Observed only: the last passing version had this page route and this source doesn't; check that this is intended.
