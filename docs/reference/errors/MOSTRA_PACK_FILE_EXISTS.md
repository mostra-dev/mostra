---
code: MOSTRA_PACK_FILE_EXISTS
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PACK_FILE_EXISTS

File already exists. Severity: error. Phase: host.

## What it means

The artifact already has files where the item writes, with other content. Mostra never replaces an artifact's file without being asked, as shadcn asks before it overwrites; nothing was written.

## How to fix it

Add `--overwrite` to replace them (`mostra add <item> --artifact <path> --overwrite`), or rename your files and add the item again.

## Hint

Run the command again with `--overwrite` to replace the files the message lists, or move them first.
