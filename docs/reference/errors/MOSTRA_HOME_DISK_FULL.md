---
code: MOSTRA_HOME_DISK_FULL
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOME_DISK_FULL

Disk full. Severity: error. Phase: host.

## What it means

A ledger write failed because the disk holding the home is full. The transaction was rolled back, so nothing partial was saved and nothing that was acknowledged earlier is lost. Viewers keep unsaved edits in their browser until a retry succeeds.

## How to fix it

Free space on that disk (`mostra gc` removes unreferenced versions; build caches can be deleted), then retry the operation. Retries with the same request or mutation ID are safe.

## Hint

Free space on the disk that holds the Mostra home, then retry.
