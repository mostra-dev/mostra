---
code: MOSTRA_PACK_ITEM_INVALID
severity: error
phase: manifest
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PACK_ITEM_INVALID

Registry item invalid. Severity: error. Phase: manifest.

## What it means

The item isn't a shadcn registry item Mostra can install: it isn't JSON, misses `name` or `type`, a file has no `path`, a `registry:file` or `registry:page` has no `target`, a file has neither `content` nor a path its registry holds, or the `mostra` block has a wrong value. Every field shadcn's schema allows is accepted, and unknown keys are kept.

## How to fix it

Correct the item (its JSON Schema is `https://ui.shadcn.com/schema/registry-item.json`, plus the `mostra` block in `@mostra/protocol/schemas/plugin-manifest.schema.json`).

## Hint

Fix the field this diagnostic names in the item's JSON.
