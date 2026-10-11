---
code: MOSTRA_MANIFEST_NOT_LITERAL
severity: error
phase: manifest
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_MANIFEST_NOT_LITERAL

Manifest isn't a literal. Severity: error. Phase: manifest.

## What it means

Mostra reads an artifact's manifest without running its code: the `export const artifact = defineArtifact({...})` in a TSX entry, or the frontmatter of an MDX entry. It reports this code when the exported `artifact` isn't a `defineArtifact(...)` call with one object literal, or when a value inside it needs evaluation (an identifier, a function call, a spread, a computed key, a template literal with `${}`). The location points at the first such value.

## How to fix it

Replace the value with the literal it stands for, for example `title: "Q3 review"` instead of `title: TITLE`. Keep computed values in the page code, where they can use anything. `as const` and `satisfies` on the object are fine.

## Hint

Write the manifest as plain values: strings, numbers, booleans, null, arrays and objects, with no variables, calls, spreads or computed keys.
