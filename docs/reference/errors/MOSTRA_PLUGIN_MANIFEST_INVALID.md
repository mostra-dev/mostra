---
code: MOSTRA_PLUGIN_MANIFEST_INVALID
severity: error
phase: manifest
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PLUGIN_MANIFEST_INVALID

Plugin manifest invalid. Severity: error. Phase: manifest.

## What it means

A field of the plugin's manifest, the `"mostra"` key of its `package.json`, isn't one Mostra can load: a required field is missing, a value has the wrong form, a contribution kind has no contract range, an ID is contributed twice, a command would take one of `mostra`'s own words, or a license isn't an SPDX expression. The location points at the field, and `mostra plugin validate` reports every one at once.

## How to fix it

Correct the field (the message says what it expects) and validate again. The manifest's shape is published as JSON Schema in `@mostra/protocol/schemas/plugin-manifest.schema.json`.

## Hint

Fix the field this diagnostic names in the plugin's package.json, then run `mostra plugin validate` again.
