---
code: MOSTRA_ARTIFACT_NO_PAGE
severity: error
phase: manifest
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ARTIFACT_NO_PAGE

Entry has no page. Severity: error. Phase: manifest.

## What it means

The entry has no default export and the artifact has no `pages/` folder, so there is nothing to render. With `pages/`, each file there is a route and the entry's default export, when present, is the layout around them.

## How to fix it

Add `export default function Page() { ... }` to the entry, or move pages into `pages/index.tsx`, `pages/settings.tsx` and so on.

## Hint

Export the page component as the entry's default export, or add a `pages/` folder.
