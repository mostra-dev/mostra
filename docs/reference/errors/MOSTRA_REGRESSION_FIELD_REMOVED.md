---
code: MOSTRA_REGRESSION_FIELD_REMOVED
severity: warning
phase: contract
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REGRESSION_FIELD_REMOVED

Field gone since the last passing version. Severity: warning. Phase: contract.

## What it means

A field ID the last passing version used is gone from this source. Viewers' answers under it become orphans when they switch (D42): kept, shown read-only and delivered, but not editable. The message gives how many saved answers it affects.

## How to fix it

If the field was renamed by mistake, keep its old ID. If it was removed on purpose, nothing needs to change.

## Hint

Observed only: answers saved under this field ID won't carry over to this version; a field removed on purpose needs nothing more.
