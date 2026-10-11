---
code: MOSTRA_HOME_TOO_NEW
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOME_TOO_NEW

Home written by a newer Mostra. Severity: error. Phase: host.

## What it means

A newer Mostra migrated this home's ledger to a schema version this runtime doesn't know. Reading it could misinterpret or lose data, so this runtime refuses to open it. The message names the schema version and the release that wrote it.

## How to fix it

Upgrade the runtime (or the host or CLI that bundles it) to at least the release named in the message. Mostra never migrates a ledger backwards; to keep an older release, give it a separate home with `--home` or `MOSTRA_HOME`.

## Hint

Run a Mostra release at least as new as the one named in the message, or use another home with `--home`.
