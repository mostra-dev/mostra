---
code: MOSTRA_TARGET_EXPORT_STRICT
severity: error
phase: publish
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_TARGET_EXPORT_STRICT

A strict export found what it would lose. Severity: error. Phase: publish.

## What it means

`--strict` makes every warning of an export an error: the export found something it would lose or couldn't carry, named in the warnings beside this error, and wrote nothing.

## How to fix it

Read the warnings: export another class (`snapshot`, `bundle`, `static`), give the export what it needs (`--base`), or drop `--strict` to accept them.

## Hint

Fix what the warnings name, or export without `--strict`.
