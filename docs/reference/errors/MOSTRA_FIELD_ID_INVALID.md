---
code: MOSTRA_FIELD_ID_INVALID
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_FIELD_ID_INVALID

Invalid field ID. Severity: error. Phase: runtime.

## What it means

Every persisted value has an explicit, stable field ID (D52). An ID is 1 to 256 characters with no control characters; dots separate the parts that nest in results (`reply.m1`), so it can't start or end with a dot or hold two in a row.

## How to fix it

Give the field a fixed ID such as `layout` or `reply.m1` (one per message, from its ID), and keep it the same across renders and versions so drafts carry over.

## Hint

Use a stable field ID of 1 to 256 characters: dot-separated parts, none empty.
