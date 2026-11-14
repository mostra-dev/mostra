---
code: MOSTRA_PACK_ITEM_NOT_FOUND
severity: error
phase: network
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PACK_ITEM_NOT_FOUND

Registry item not found. Severity: error. Phase: network.

## What it means

The registry answered that the item doesn't exist (HTTP 404), the local file isn't there, or a GitHub repository's root `registry.json` has no item by that name. The message names the address and where Mostra looked.

## How to fix it

Correct the address. For a GitHub item, `owner/repo/item` names an item of the repository's root `registry.json`, at its default branch unless `#ref` says otherwise.

## Hint

Check the address; for a GitHub item, check the repository's registry.json and the ref.
