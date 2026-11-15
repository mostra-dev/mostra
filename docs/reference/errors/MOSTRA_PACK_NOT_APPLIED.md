---
code: MOSTRA_PACK_NOT_APPLIED
severity: hint
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PACK_NOT_APPLIED

Item part not applied. Severity: hint. Phase: host.

## What it means

The item asks for something an artifact doesn't have: environment variables (`envVars`; server code reads secrets with `secret()`, set by `mostra secret set`), a Tailwind 3 configuration (`tailwind.config`; Tailwind 4 reads `cssVars.theme`), a font through `next/font`, or a design-system configuration (`registry:base`, `registry:style`). Mostra installs the rest and lists these.

## How to fix it

Set the secrets the item's server code needs with `mostra secret set NAME`, and move any Tailwind 3 theme into the item's `cssVars.theme` or your stylesheet's `@theme`.

## Hint

Read what the item asked for and apply it yourself if the artifact needs it.
