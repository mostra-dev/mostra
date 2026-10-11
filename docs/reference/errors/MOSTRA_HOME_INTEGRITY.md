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

Leave files inside the home unchanged. To repair a version, publish the same source again: Mostra rebuilds the version's directory and puts it back under the same version ID, and the artifact keeps its version number. If the source has changed since, the publish makes a new version and the damaged one stays as it is; its source snapshot in the home holds the original files. `mostra doctor` lists other damaged objects.

## Hint

Publish the version's source again to rebuild a damaged version in place, and run `mostra doctor` for other damaged objects.
