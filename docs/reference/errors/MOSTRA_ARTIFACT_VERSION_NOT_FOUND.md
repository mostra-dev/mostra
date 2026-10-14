---
code: MOSTRA_ARTIFACT_VERSION_NOT_FOUND
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ARTIFACT_VERSION_NOT_FOUND

No such version. Severity: error. Phase: host.

## What it means

The request named a version number or version ID that this artifact never published in this home. Viewers only ever open published versions (D09), so there is nothing to show.

## How to fix it

List the artifact's versions with `artifact/get` and pick one, or omit the version to open the latest. A link to `/a/<artifactId>/v/<number>` needs a number from that list.

## Hint

Name a version the artifact has (`artifact/get` lists them), or leave the version out for the latest.
