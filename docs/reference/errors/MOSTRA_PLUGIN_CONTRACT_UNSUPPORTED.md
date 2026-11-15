---
code: MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED
severity: error
phase: contract
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PLUGIN_CONTRACT_UNSUPPORTED

Contract version not implemented. Severity: error. Phase: contract.

## What it means

The plugin declares a contract range, or carries a definition stamped with a contract version, that this Mostra release doesn't serve. Each extension contract is its own package with its own version (D30): within a line changes are additive, so Mostra serves stamps of its line up to the version it implements, and a range must admit that version. The message names the contract, the plugin's range or stamp, and the version this release implements. Mostra reports it when the plugin is added, and when `verify` or `publish` loads it, so an artifact whose plugin a newer runtime no longer serves is told before it is published.

## How to fix it

Add a release of the plugin whose range admits the version the message names (`mostra plugin add <package>@<version> --artifact <path>`), or run a Mostra release that implements the plugin's contract version, or remove the plugin with `mostra plugin remove`.

## Hint

Install a version of the plugin built for this Mostra's contracts, or update Mostra.
