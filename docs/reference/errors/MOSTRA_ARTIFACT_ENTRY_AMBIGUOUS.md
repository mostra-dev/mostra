---
code: MOSTRA_ARTIFACT_ENTRY_AMBIGUOUS
severity: error
phase: manifest
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ARTIFACT_ENTRY_AMBIGUOUS

More than one entry file. Severity: error. Phase: manifest.

## What it means

A directory artifact has exactly one entry, and this directory has more than one of `index.tsx`, `index.jsx` and `index.mdx`, so Mostra can't tell which one is the page.

## How to fix it

Keep the entry you mean and rename the others, for example into `components/`.

## Hint

Keep one entry file in the directory and rename or remove the others.
