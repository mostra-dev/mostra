---
code: MOSTRA_ARTIFACT_SOURCE_MISSING
severity: error
phase: publish
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ARTIFACT_SOURCE_MISSING

Artifact source missing. Severity: error. Phase: publish.

## What it means

Publishing needs the artifact's source files. The path given, or the path the artifact was last published from, doesn't exist. Versions already published stay readable, because Mostra keeps a snapshot of their source in the home.

## How to fix it

Pass the path where the source lives now. Its manifest `id`, if it has one, keeps the artifact identity at the new path.

## Hint

Publish from the artifact's source path, or restore the directory the message names.
