---
code: MOSTRA_REMOTE_QUEUE_FULL
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REMOTE_QUEUE_FULL

Too many runs wait for the owner. Severity: error. Phase: host.

## What it means

The artifact's owner instance is offline and as many runs as the server allows already wait for it, or the server's operator allows no more waiting runs for this account now (its `limits` port, `run.wait`, whose message is the operator's own), so this one was refused before anything was recorded. Runs already waiting keep their place.

## How to fix it

Bring the owner instance back online: waiting runs then go out in the order they were made. The cap is the server's `relay.waitingRunsPerArtifact` setting, or the operator's limit its message names; its `Retry-After`, when present, says when to try again.

## Hint

Wait for the owner to come back and work through its queue, then press again.
