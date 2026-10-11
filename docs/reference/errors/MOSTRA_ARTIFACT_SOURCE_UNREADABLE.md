---
code: MOSTRA_ARTIFACT_SOURCE_UNREADABLE
severity: error
phase: publish
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ARTIFACT_SOURCE_UNREADABLE

Artifact source can't be read. Severity: error. Phase: publish.

## What it means

Mostra couldn't read a file of the artifact's source: permissions, a file that disappeared while it was copied, or two names that are the same after Unicode normalization. Nothing was published.

## How to fix it

Make the named file readable, rename one of two clashing names, or exclude the file with `.mostraignore` in the artifact's root.

## Hint

Fix the file or directory the message names so your user can read it, then publish again.
