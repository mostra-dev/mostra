---
code: MOSTRA_TARGET_SHARED_STATE
severity: warning
phase: publish
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_TARGET_SHARED_STATE

A snapshot holds other people's answers. Severity: warning. Phase: publish.

## What it means

A snapshot carries the artifact's shared state, which other people wrote (a roster's answers, votes, a shared list): the message says how many people's answers it holds. A snapshot is a file that travels, so they travel with it.

## How to fix it

Pass `--no-shared-state` to leave the shared state out, or send the snapshot only to people who may read it.

## Hint

Check that the snapshot may carry these answers, or leave the shared state out with `--no-shared-state`.
