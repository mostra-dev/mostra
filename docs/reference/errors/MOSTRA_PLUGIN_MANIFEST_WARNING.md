---
code: MOSTRA_PLUGIN_MANIFEST_WARNING
severity: warning
phase: manifest
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PLUGIN_MANIFEST_WARNING

Plugin manifest questionable. Severity: warning. Phase: manifest.

## What it means

The plugin's manifest has something this Mostra release loads around: a key it doesn't know, an effect or a system it doesn't know, or a contract declared with nothing contributed to it. Manifests grow additively, so a newer plugin may carry keys an older Mostra skips; a misspelled key is skipped the same way, which can leave a contribution or a license undeclared.

## How to fix it

Correct the field if it is a mistake. If it is something a newer Mostra reads, nothing is needed.

## Hint

Check the field this diagnostic names; Mostra loads the plugin and ignores what it doesn't know.
