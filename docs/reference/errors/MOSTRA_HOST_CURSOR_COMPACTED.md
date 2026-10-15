---
code: MOSTRA_HOST_CURSOR_COMPACTED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOST_CURSOR_COMPACTED

Events compacted. Severity: error. Phase: host.

## What it means

Events before a cursor were compacted on request (`mostra gc --compact-events`, DATA_MODEL §4): an artifact's old events were replaced by one `artifact.compacted` event that summarizes them. A reader asking for events after an earlier cursor would miss some, and Mostra never leaves a silent gap.

## How to fix it

Read again with `after` set to the cursor the message names: the next event is the `artifact.compacted` summary. Rebuild what you track from it and continue as usual.

## Hint

Read from the cursor in the message to receive the compaction summary, then continue from there.
