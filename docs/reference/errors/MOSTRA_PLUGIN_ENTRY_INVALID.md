---
code: MOSTRA_PLUGIN_ENTRY_INVALID
severity: error
phase: contract
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PLUGIN_ENTRY_INVALID

Plugin entry doesn't load. Severity: error. Phase: contract.

## What it means

A contribution's `entry` module is missing from the package, leaves it, failed to load, or doesn't export (at `export`, `default` when absent) a definition stamped by the contract's blueprint (`defineExporter`, `defineCliCommand` …) with the ID the manifest gives. Mostra reads the stamp from the loaded object itself, in a child process of the instance, so a manifest alone can't claim a contract. Contributions that run in the page (embed engines, anchor providers) are checked when the page uses them.

## How to fix it

Build the plugin so the module exists, export the value its `define*` function returns, and keep the manifest's ID equal to the definition's. Then run `mostra plugin validate <dir>`.

## Hint

Fix the module the message names so it exports the definition its contract's define function returns.
