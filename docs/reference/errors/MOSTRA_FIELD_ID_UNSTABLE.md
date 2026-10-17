---
code: MOSTRA_FIELD_ID_UNSTABLE
severity: error
phase: lint
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_FIELD_ID_UNSTABLE

Field ID changes between renders. Severity: error. Phase: lint.

## What it means

Verify loaded the page twice with identical inputs and a fixed clock, and a field ID differed between the two loads. A viewer's saved answer would then be lost on every reload. IDs an interaction creates, such as a new list row's, are new fields and aren't reported.

## How to fix it

Derive the ID from something stable, for example a template with the record's ID instead of one with `Math.random()`.

## Hint

Build the field's ID from stable data, such as a record's ID, never from random numbers or the time.
