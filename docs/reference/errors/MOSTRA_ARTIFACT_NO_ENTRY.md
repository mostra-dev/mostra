---
code: MOSTRA_ARTIFACT_NO_ENTRY
severity: error
phase: manifest
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ARTIFACT_NO_ENTRY

No entry file. Severity: error. Phase: manifest.

## What it means

An artifact is a single `.tsx`, `.jsx` or `.mdx` file, or a directory whose entry is `index.tsx`, `index.jsx` or `index.mdx`. The source given is neither.

## How to fix it

Create the entry: its default export is the page, and its manifest is `export const artifact = defineArtifact({ title: "..." })` (or frontmatter in MDX). For a single page, publish the file itself.

## Hint

Add `index.tsx` or `index.mdx` to the directory, or publish a single `.tsx` or `.mdx` file.
