---
code: MOSTRA_KIT_THEME_FILE_MISSING
severity: error
phase: manifest
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_KIT_THEME_FILE_MISSING

Theme file missing. Severity: error. Phase: manifest.

## What it means

An entry of the manifest's theme stack names a CSS file of the artifact (`./brand.css`) that isn't in its source, so the stack can't be built.

## How to fix it

Add the file at the path the message names, relative to the artifact's root, or remove the entry: `kit: { theme: ["studio"] }`.

## Hint

Create the CSS file the stack names, or take it out of `kit.theme`.
