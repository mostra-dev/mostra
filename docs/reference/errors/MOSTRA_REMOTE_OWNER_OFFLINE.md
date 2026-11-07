---
code: MOSTRA_REMOTE_OWNER_OFFLINE
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REMOTE_OWNER_OFFLINE

The artifact's owner instance is offline. Severity: error. Phase: host.

## What it means

A hosted page called server code its owner instance runs, and the owner instance isn't connected. A plain call isn't kept, so it is refused at once; an action run waits or fails as the artifact's `hosted.offline` says.

## How to fix it

Start Mostra on the owner's machine (`mostra daemon start`, or `mostra daemon install` for always-on). An action that must work while the owner is away should be an action run with `hosted.offline.actions: "queue"`.

## Hint

Start Mostra on the machine that shared the page, or try again once it is back.
