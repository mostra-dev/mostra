---
code: MOSTRA_PACK_TARGET_INVALID
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PACK_TARGET_INVALID

Item file outside the artifact. Severity: error. Phase: host.

## What it means

A file of the item would land outside the artifact's directory (`../`, an absolute path), on a name not every system can hold (`<>:"|?*`, a Windows device name, a trailing dot or space), on Mostra's own files, or on two names that differ only in case. Nothing was written.

## How to fix it

Use a corrected item, or copy the files you need into the artifact yourself.

## Hint

Ask the item's author to fix its target; Mostra writes an item's files only inside the artifact.
