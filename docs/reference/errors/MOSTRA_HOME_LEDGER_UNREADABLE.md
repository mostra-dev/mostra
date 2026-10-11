---
code: MOSTRA_HOME_LEDGER_UNREADABLE
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOME_LEDGER_UNREADABLE

Ledger can't be read. Severity: error. Phase: host.

## What it means

The ledger (`store/ledger.sqlite` in the home) holds drafts, submissions, events and the rest of the home's interaction data. Mostra reports this code when the file can't be opened, isn't a SQLite database, isn't a Mostra ledger, or fails SQLite's integrity check. Mostra never replaces an existing ledger with an empty one.

## How to fix it

Stop every Mostra process for this home. Copy `store/ledger.sqlite` somewhere safe, then restore the newest `store/ledger.sqlite.bak-<from>-<to>` in its place, or move the damaged file aside to start an empty ledger. Versions, sources and blobs in the home are untouched either way.

## Hint

Restore the ledger from the latest `ledger.sqlite.bak-*` backup in the home's `store/` directory, or move the damaged file aside.
