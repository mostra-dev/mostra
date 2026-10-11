---
code: MOSTRA_PUBLISH_ID_CONFLICT
severity: error
phase: publish
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PUBLISH_ID_CONFLICT

Artifact ID claimed by two sources. Severity: error. Phase: publish.

## What it means

An artifact's `id` names exactly one source. Mostra reports this code when a manifest claims an `id` that is already bound to another source path whose entry still claims it, which usually means a directory was copied. A source that moved, so that the old path no longer claims the `id`, is rebound instead. The message names both paths.

## How to fix it

Decide which source is the artifact. In the other one, remove the `id` from the manifest (it is then bound to its own path at its first publish) or replace it with a new ID from `mostra new`.

## Hint

Give one of the two sources a different `id`, or delete the `id` line from the copy so it becomes a new artifact.
