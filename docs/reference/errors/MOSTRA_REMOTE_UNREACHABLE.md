---
code: MOSTRA_REMOTE_UNREACHABLE
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REMOTE_UNREACHABLE

The remote server can't be reached. Severity: error. Phase: host.

## What it means

The owner instance couldn't reach the remote server that holds this hosted artifact, so a write that must go there (its artifact state, a live value) was refused, never applied locally alone (D165 item 1). Nothing was lost: a page's edit stays in its journal and is sent again.

## How to fix it

Run `mostra status` to see each server's link. When the server is back the link reconnects by itself; then write again.

## Hint

Check the network and the server's address, then try again; mostra status shows the link.
