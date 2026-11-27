---
code: MOSTRA_DEMO_BASE_NEEDED
severity: warning
phase: publish
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEMO_BASE_NEEDED

A demo works fully only at a host's root. Severity: warning. Phase: publish.

## What it means

A demo that moves between its pages by browser history was built for the path Mostra serves it under. In this export it works fully when the folder is served at a host's root (`npx serve <folder>`), and on its opening page when the folder is served from a subpath or opened from disk.

## How to fix it

Export with the subpath the folder will be served from, such as `--base /my-repo/` for a GitHub Pages project site: Mostra rebuilds each demo under it.

## Hint

To host the export at a subpath, export it again with `--base <path>`.
