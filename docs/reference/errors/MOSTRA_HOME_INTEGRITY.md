---
code: MOSTRA_HOME_INTEGRITY
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOME_INTEGRITY

Stored version or file damaged. Severity: error. Phase: host.

## What it means

Mostra checks stored versions, source snapshots and blobs against their recorded content digests before using them. This code means a stored object is missing or its content changed after it was written, for example after a disk error or a manual edit inside the home. The message names the object.

## How to fix it

Leave files inside the home unchanged. Republishing the artifact from its source writes a fresh version; `mostra doctor` lists other damaged objects.

## Hint

Run `mostra doctor`; publish the artifact again to rebuild a damaged version.
