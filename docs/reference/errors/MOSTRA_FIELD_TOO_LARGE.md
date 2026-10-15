---
code: MOSTRA_FIELD_TOO_LARGE
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_FIELD_TOO_LARGE

Field value too large. Severity: error. Phase: runtime.

## What it means

A field value is at most 1 MiB of JSON and a draft or artifact state at most 16 MiB in all (DATA_MODEL §5). This write would pass one of those limits, so Mostra refused it whole: nothing was truncated, and the page keeps the value locally.

## How to fix it

Split the value across several fields, or store binary data as a blob and keep its reference in the field.

## Hint

Store large data as a blob or split it across fields; keep each value under 1 MiB.
