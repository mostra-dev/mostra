---
code: MOSTRA_PLUGIN_OPTIONS_INVALID
severity: error
phase: contract
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PLUGIN_OPTIONS_INVALID

Exporter options invalid. Severity: error. Phase: contract.

## What it means

The options given to a plugin's exporter don't fit the JSON Schema its definition declares (`options`), or it declares none and was given some. Mostra checks them in the plugin's child before the exporter runs, so nothing was exported.

## How to fix it

Read the exporter's options in its plugin's documentation (`mostra plugin list` names the plugin), and run `mostra export <artifact> --as <exporter> --out <path> --option name=value` with them. A value that reads as JSON (`3`, `true`, `["a"]`) is passed as that value, anything else as text.

## Hint

Give the options the exporter's schema asks for, each as `--option name=value`.
