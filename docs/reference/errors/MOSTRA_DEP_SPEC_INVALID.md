---
code: MOSTRA_DEP_SPEC_INVALID
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEP_SPEC_INVALID

Invalid package spec. Severity: error. Phase: host.

## What it means

A package spec given to `mostra add` (`deps/add`) isn't an npm registry spec. Mostra adds packages from the registry by name, optionally with a version, a semver range or a dist-tag; scoped names such as `@scope/name@1.2.3` work too. Git URLs, local paths and tarball URLs aren't registry specs.

## How to fix it

Correct the spec, for example `mostra add three@0.186.1` or `mostra add @xyflow/react`.

## Hint

Write the spec as `name`, `name@version`, `name@range` or `name@tag`.
