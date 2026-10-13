---
code: MOSTRA_DEP_NOT_FOUND
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEP_NOT_FOUND

Package not found. Severity: error. Phase: compile.

## What it means

The registry has no package by that name, or no version that matches the requested one. A spec without an exact version only matches releases at least a day old, so a package whose every release is newer than that isn't found either. The message names the package and what the registry answered.

## How to fix it

Correct the package name in the import or in the `mostra add` spec. To use a release less than a day old, add it at its exact version: `mostra add <package>@<version>`.

## Hint

Check the package name and version against the npm registry, then fix the import or the spec.
