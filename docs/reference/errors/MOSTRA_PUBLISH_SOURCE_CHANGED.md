---
code: MOSTRA_PUBLISH_SOURCE_CHANGED
severity: error
phase: publish
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PUBLISH_SOURCE_CHANGED

Source changed during the publish. Severity: error. Phase: publish.

## What it means

Publishing reads the entry's manifest twice: once to find the artifact, and again from the snapshot it builds. Mostra reports this code when the two disagree about which artifact the source is, because the manifest `id` or the source's binding changed while the publish ran, for example when an editor saved the entry mid-publish or another publish rebound the path. Nothing was published.

## How to fix it

Wait until the files are saved and nothing else is publishing the same source, then publish again. If the manifest `id` was changed on purpose, the next publish uses the new one.

## Hint

Publish again once the artifact's files have stopped changing.
