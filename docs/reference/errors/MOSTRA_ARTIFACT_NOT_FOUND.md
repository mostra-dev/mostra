---
code: MOSTRA_ARTIFACT_NOT_FOUND
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ARTIFACT_NOT_FOUND

Artifact not found. Severity: error. Phase: host.

## What it means

The artifact named by an ID or a source path doesn't exist in this home: the ID was never published here, or the path was never published.

## How to fix it

Use an ID or path from `mostra list`. A source that was never published becomes an artifact at its first `mostra publish`. A host that uses its own home sees only the artifacts published there.

## Hint

Check the artifact ID or source path, or list the home's artifacts with `mostra list`.
