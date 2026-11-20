---
code: MOSTRA_KIT_CSS_UNPROCESSED
severity: warning
phase: lint
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_KIT_CSS_UNPROCESSED

Tailwind CSS that isn't processed. Severity: warning. Phase: lint.

## What it means

A CSS file of the artifact uses Tailwind's directives (`@theme`, `@apply`, `@utility`, `@variant`) but isn't processed by Tailwind: it neither imports Tailwind nor is a layer of the theme stack, so the directives reach the page unchanged and do nothing, and verify sees no error.

## How to fix it

List the file in the theme stack, after a theme (`kit: { theme: ["studio", "./brand.css"] }`), so it joins the build's one Tailwind run; or begin it with `@import "tailwindcss";`.

## Hint

Name the file in `kit.theme`, or start it with `@import "tailwindcss";`.
