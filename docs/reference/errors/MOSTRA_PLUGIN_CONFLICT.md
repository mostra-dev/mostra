---
code: MOSTRA_PLUGIN_CONFLICT
severity: error
phase: contract
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PLUGIN_CONFLICT

Plugins contribute the same ID. Severity: error. Phase: contract.

## What it means

Two plugins of one artifact, or one of the artifact's and one of the home's, contribute the same ID to the same contract (two exporters `pdf`, two commands `term record`), or a plugin takes an ID Mostra builds in (the exporters `static`, `html`, `bundle` and `snapshot`). Nothing is overridden silently (ROUND-3 §6.4): the message names both sides.

## How to fix it

Remove one plugin with `mostra plugin remove <package> --artifact <path>` (or `--global`), then add the other again if needed.

## Hint

Remove one of the two plugins the message names, or use releases whose IDs differ.
