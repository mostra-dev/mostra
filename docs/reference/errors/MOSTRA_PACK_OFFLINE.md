---
code: MOSTRA_PACK_OFFLINE
severity: error
phase: network
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PACK_OFFLINE

Registry item unavailable offline. Severity: error. Phase: network.

## What it means

Mostra is offline (`MOSTRA_OFFLINE` is set, or no network interface is up), and the item, or one of its registry dependencies, is on a remote registry. Nothing was written.

## How to fix it

Run the command again with the network up, or download the item and add it from its file: `mostra add ./item.json --artifact <path>`.

## Hint

Connect to the network, or add the item from a local .json file.
