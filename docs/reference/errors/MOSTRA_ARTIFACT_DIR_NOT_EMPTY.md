---
code: MOSTRA_ARTIFACT_DIR_NOT_EMPTY
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ARTIFACT_DIR_NOT_EMPTY

Directory isn't empty. Severity: error. Phase: host.

## What it means

Creating an artifact writes its entry into a directory, and the directory given already has files. Mostra never overwrites them.

## How to fix it

Pass a path that doesn't exist yet or an empty directory. To make existing files an artifact, add the entry yourself and publish.

## Hint

Choose a new or empty directory for the artifact.
