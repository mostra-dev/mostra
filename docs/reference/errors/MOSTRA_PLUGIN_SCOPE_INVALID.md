---
code: MOSTRA_PLUGIN_SCOPE_INVALID
severity: error
phase: contract
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PLUGIN_SCOPE_INVALID

Plugin can't be installed there. Severity: error. Phase: contract.

## What it means

Plugins are installed for one artifact (recorded in its lockfile, part of its versions) or, when they contribute only exporters and CLI commands, for the whole home (ROUND-3 §6.4). This plugin contributes something that changes what an artifact's version is (an embed engine, a verify check, an anchor provider, a connector or a pack), so it can't be installed for the home; or the call named both scopes or neither.

## How to fix it

Run `mostra plugin add <package> --artifact <path>` for each artifact that uses it.

## Hint

Install the plugin for an artifact with `--artifact`, or pass exactly one of `--artifact` and `--home`.
