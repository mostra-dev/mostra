---
code: MOSTRA_FIELD_UNBOUND
severity: hint
phase: smoke
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_FIELD_UNBOUND

Input not bound to a field. Severity: hint. Phase: smoke.

## What it means

Verify's smoke test typed into an input and the page saved nothing: the input isn't bound to a field, so what a viewer types there is lost on reload and isn't part of a submission. A search box or a filter may be meant that way.

## How to fix it

Use `const [value, setValue] = useField("<id>", "")` for the input's value, or leave it if it isn't meant to persist.

## Hint

Bind the input with `useField` (or a kit input with an `id`) if its value should be saved and submitted.
