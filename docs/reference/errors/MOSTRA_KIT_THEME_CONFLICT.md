---
code: MOSTRA_KIT_THEME_CONFLICT
severity: error
phase: manifest
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_KIT_THEME_CONFLICT

Two themes share an id. Severity: error. Phase: manifest.

## What it means

Two themes the artifact can use have the same id: two installed plugins contribute it, or a plugin contributes one with a built-in theme's id. Mostra overrides neither (D172), so the stack can't say which it means.

## How to fix it

Remove one of the plugins the message names with `mostra plugin remove <package> --artifact <dir>`.

## Hint

Uninstall one of the two plugins, or ask its author to rename the theme.
