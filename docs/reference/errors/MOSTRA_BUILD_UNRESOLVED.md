---
code: MOSTRA_BUILD_UNRESOLVED
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_BUILD_UNRESOLVED

Import can't be resolved. Severity: error. Phase: compile.

## What it means

An import in the artifact names a file or package the builder can't find. Relative imports resolve inside the artifact's own files, `@/...` resolves from the artifact's root, and package imports resolve from Mostra's warm set and the artifact's installed packages. The message names the import and the file that contains it.

## How to fix it

For a file, check the path and its extension against the artifact's files. For a package, check its name; packages outside the warm set install with `mostra add <package>`.

## Hint

Correct the import path, or import the package from the warm set or add it with `mostra add`.
