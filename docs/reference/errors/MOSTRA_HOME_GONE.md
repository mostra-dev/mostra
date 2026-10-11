---
code: MOSTRA_HOME_GONE
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOME_GONE

Home directory removed. Severity: error. Phase: host.

## What it means

The instance's home directory disappeared or was replaced while the instance was running. Writing anywhere else could split the home's data, so the instance stops accepting requests, stops its child processes and exits.

## How to fix it

Put the home back (or choose a new one with `--home` or `MOSTRA_HOME`) and start Mostra again. Clients reconnect and retry their requests by ID.

## Hint

Restore or recreate the home directory, then start Mostra again.
