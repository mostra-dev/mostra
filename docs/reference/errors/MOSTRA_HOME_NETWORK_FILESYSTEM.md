---
code: MOSTRA_HOME_NETWORK_FILESYSTEM
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOME_NETWORK_FILESYSTEM

Data directory on a network filesystem. Severity: error. Phase: host.

## What it means

A remote server's data directory holds its hosted homes' ledgers and locks, which need a local disk: on a network filesystem a lock can seem held by two machines at once, and SQLite's WAL can't share memory across them (D165 item 0b). The server refuses a data directory it detects on NFS, SMB, AFP, WebDAV or a FUSE mount, before it opens anything.

## How to fix it

Pass `--data` a directory on a local disk. To keep a copy elsewhere, replicate the homes with a backup tool instead.

## Hint

Put the server's data directory on a local disk.
