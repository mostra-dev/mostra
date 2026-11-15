---
code: MOSTRA_PLUGIN_NOT_INSTALLED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PLUGIN_NOT_INSTALLED

Plugin not installed. Severity: error. Phase: host.

## What it means

The package isn't one of the plugins of the artifact (or of the home) the call names, so there is nothing to remove.

## How to fix it

List the scope's plugins with `mostra plugin list --artifact <path>` (or `--global`) and use a name from it.

## Hint

Check the package name against `mostra plugin list`.
