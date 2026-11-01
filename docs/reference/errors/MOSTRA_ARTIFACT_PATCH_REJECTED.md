---
code: MOSTRA_ARTIFACT_PATCH_REJECTED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ARTIFACT_PATCH_REJECTED

Patch doesn't apply. Severity: error. Phase: host.

## What it means

An `artifact_patch` changes a file only when every edit applies: each `old` text must appear exactly once in the file as it is now, and each hunk of a unified diff must match its lines. When one doesn't, nothing is written, and the message lists each edit or hunk that didn't apply and why (not found, found more than once, the file is missing).

## How to fix it

Use a longer `old` text that appears only once, fix the hunk's context lines, or write the whole file with `artifact_write`.

## Hint

Read the file again and send edits whose `old` text appears in it exactly once, or a diff made against its current content.
