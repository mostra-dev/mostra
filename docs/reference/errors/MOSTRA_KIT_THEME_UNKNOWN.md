---
code: MOSTRA_KIT_THEME_UNKNOWN
severity: error
phase: manifest
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_KIT_THEME_UNKNOWN

Theme not found. Severity: error. Phase: manifest.

## What it means

An entry of the manifest's theme stack (`kit.theme`) names a theme that isn't built in and that no plugin installed for the artifact contributes, so the page can't be built in it. The message lists the themes on offer.

## How to fix it

Correct the name (`kit: { theme: "studio" }`), or install the plugin first with `mostra plugin add <package> --artifact <dir>`.

## Hint

Name a theme `mostra theme list` shows, or install the plugin that contributes it.
