---
code: MOSTRA_DEP_WARM_CONFLICT
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEP_WARM_CONFLICT

Warm package version requested. Severity: error. Phase: compile.

## What it means

The package is part of Mostra's warm set, which every artifact resolves at one fixed version so that React and the other shared packages exist exactly once. The requested version doesn't match the warm one, and an artifact can't replace a warm package.

## How to fix it

Drop the version from the spec (`mostra add react`), or request a range the warm version satisfies. The message names the warm version.

## Hint

Add the package without a version, or with one the warm set's version satisfies.
