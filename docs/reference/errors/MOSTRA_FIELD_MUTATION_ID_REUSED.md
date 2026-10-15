---
code: MOSTRA_FIELD_MUTATION_ID_REUSED
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_FIELD_MUTATION_ID_REUSED

Mutation ID reused. Severity: error. Phase: runtime.

## What it means

A mutation ID identifies one change, so a retry after a timeout replays its recorded result (IN-01). This ID was already used for a change with other contents or another target. Mostra refuses it rather than answer with the result of a change nobody sent now.

## How to fix it

Create a fresh `mut_` ID for each change and reuse an ID only to retry exactly the same change.

## Hint

Generate a new mutation ID for every new change.
