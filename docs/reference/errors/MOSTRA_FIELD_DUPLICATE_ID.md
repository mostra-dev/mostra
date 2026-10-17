---
code: MOSTRA_FIELD_DUPLICATE_ID
severity: error
phase: lint
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_FIELD_DUPLICATE_ID

Field ID used for two different fields. Severity: error. Phase: lint.

## What it means

One field ID is used for two different fields: with two hook kinds (`useField` and `useChoice`, say), two scopes (`viewer` and `artifact`), or initial values of two types. The two would overwrite each other's saved value. The same ID used the same way twice is a deliberately shared value and isn't reported here.

## How to fix it

Rename one of them, for example `notes` and `notes.summary`, so each persisted value has its own ID.

## Hint

Give each of these fields its own ID.
