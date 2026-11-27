---
code: MOSTRA_TARGET_NOT_INLINED
severity: warning
phase: publish
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_TARGET_NOT_INLINED

An export needs a network for some files. Severity: warning. Phase: publish.

## What it means

The export couldn't hold some files the page loads, because they come from another address (an external font, image or script): the message lists each. They load only where the export is opened with a network.

## How to fix it

Put the files in the artifact (its `public/` folder, or imported from its source) so the export carries them.

## Hint

Load these files from the artifact itself, or expect them to need a network where the export is opened.
