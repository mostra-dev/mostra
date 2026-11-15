---
code: MOSTRA_PACK_FETCH_FAILED
severity: error
phase: network
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PACK_FETCH_FAILED

Registry item couldn't be read. Severity: error. Phase: network.

## What it means

Reading the item failed: the registry couldn't be reached, answered an error other than 404, sent more than 8 MiB, took longer than 30 s, or redirected to an address Mostra doesn't follow. Nothing was written.

## How to fix it

Run the command again once the registry answers. Behind a proxy, set `HTTPS_PROXY` for the Mostra daemon.

## Hint

Check the network and the registry, then run the command again.
