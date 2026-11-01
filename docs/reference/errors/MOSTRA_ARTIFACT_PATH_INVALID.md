---
code: MOSTRA_ARTIFACT_PATH_INVALID
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ARTIFACT_PATH_INVALID

File path outside the artifact. Severity: error. Phase: host.

## What it means

`artifact_write` and `artifact_patch` change an artifact's own files, which live in its directory. A path that is absolute, climbs out with `..`, names the directory itself or passes through a link to somewhere else names no file of the artifact, so nothing is written.

## How to fix it

Give each file's path relative to the artifact's directory, with `/` between folders. To write elsewhere, use your own file tools.

## Hint

Name the file by a relative path inside the artifact's directory, such as `index.tsx` or `components/chart.tsx`.
