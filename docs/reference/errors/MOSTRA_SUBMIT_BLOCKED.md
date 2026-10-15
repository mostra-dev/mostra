---
code: MOSTRA_SUBMIT_BLOCKED
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SUBMIT_BLOCKED

Answers missing before submit. Severity: error. Phase: runtime.

## What it means

Before a submit, the shell and the client runtime check every mounted field (D106): a `required` field without a value, a value its `validate` rejects, or a conflict the viewer hasn't resolved blocks the submit. The diagnostic lists the blockers with their field IDs and labels; `useSubmit().blockers` lists them before anyone submits. Nothing was submitted.

## How to fix it

Show `useSubmit().blockers` next to your submit button, or let the shell list them by label. Answer the required fields, fix the invalid values, and keep or take the conflicting values, then submit again.

## Hint

Fill in the fields this diagnostic lists, fix their errors or resolve their conflicts, then submit again.
