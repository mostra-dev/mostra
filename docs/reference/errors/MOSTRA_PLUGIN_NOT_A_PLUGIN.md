---
code: MOSTRA_PLUGIN_NOT_A_PLUGIN
severity: error
phase: manifest
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PLUGIN_NOT_A_PLUGIN

Not a Mostra plugin. Severity: error. Phase: manifest.

## What it means

The package has no `"mostra"` key in its `package.json`, so it contributes nothing Mostra could load. `mostra plugin add` installs only plugins; ordinary npm packages go through `mostra add`.

## How to fix it

Run `mostra add <package> --artifact <path>` for an ordinary package. For a plugin you write, add the manifest (`mostra docs guide/extending`) and run `mostra plugin validate`.

## Hint

Add the package with `mostra add` if it is an ordinary package, or give it a "mostra" manifest if it is a plugin.
