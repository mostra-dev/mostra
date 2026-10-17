---
code: MOSTRA_FIELD_SHARED
severity: hint
phase: lint
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_FIELD_SHARED

Field ID shared by several controls. Severity: hint. Phase: lint.

## What it means

Several mounted components use one field ID in the same way, so they all edit one saved value. That is how a value is shared deliberately; in a list, it can also mean every row edits the same answer.

## How to fix it

If each row should keep its own answer, include the row's identity in the ID, such as a template that adds the task's ID after `done.`.

## Hint

Nothing to fix if these controls are meant to edit one value; give each its own ID if not.
