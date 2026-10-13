---
code: MOSTRA_DEP_MISSING
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEP_MISSING

Package not added. Severity: error. Phase: compile.

## What it means

The artifact imports a package that is neither in Mostra's warm set nor in the artifact's lockfile, and the host has set the dependency policy to `explicit`. Under that policy a package enters an artifact's lockfile only when it is added on purpose, so Mostra installs nothing on its own. The location points at the first import of the package, and the fix carries the exact command that adds every missing package.

## How to fix it

Run the command from the fix (`mostra add <package…> --artifact <path>`, or the host protocol method `deps/add`), then publish again. To use a package from the warm set instead, change the import.

## Hint

Run the `mostra add` command in this diagnostic's fix, then publish again.
