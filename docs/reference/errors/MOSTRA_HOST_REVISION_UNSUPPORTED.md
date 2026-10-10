---
code: MOSTRA_HOST_REVISION_UNSUPPORTED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOST_REVISION_UNSUPPORTED

No common host protocol revision. Severity: error. Phase: host.

## What it means

A client and a Mostra instance agree on a host protocol revision when they connect (`mostra/initialize`). The client offers the revisions it speaks, and the instance picks the newest one it also supports. This code means the two lists have nothing in common, usually because the client and the running daemon come from Mostra releases far apart.

## How to fix it

Restart the daemon so it runs the same release as the client: `mostra daemon restart`. Durable state survives the restart, and open views reconnect. A host that embeds Mostra updates its pinned Mostra runtime or its host library until both support a common revision.

## Hint

Run the client and the instance from the same Mostra release, for example with `mostra daemon restart`.
