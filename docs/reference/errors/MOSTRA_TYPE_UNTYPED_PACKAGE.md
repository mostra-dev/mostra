---
code: MOSTRA_TYPE_UNTYPED_PACKAGE
severity: warning
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_TYPE_UNTYPED_PACKAGE

Package without type declarations. Severity: warning. Phase: compile.

## What it means

The artifact imports a package that ships no type declarations (TypeScript's TS7016). The package still builds and runs, so this is a warning: its values are typed `any`.

## How to fix it

Optionally add a declaration file such as `declare module "<package>";`, or a typed wrapper, to the artifact.

## Hint

Nothing breaks: the package works without types; declare a module for it if you want them checked.
