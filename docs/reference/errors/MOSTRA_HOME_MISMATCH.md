---
code: MOSTRA_HOME_MISMATCH
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOME_MISMATCH

Instance serves a different home. Severity: error. Phase: host.

## What it means

A client sent `home.path` in `mostra/initialize`, and it names a different home from the one the instance locked at start-up. The home is chosen when the instance starts (`--home`, then `MOSTRA_HOME`, then the platform default), so `home.path` is a check: it stops a client from writing to a home it didn't mean.

## How to fix it

Start the instance with `--home` set to the home the client expects, or connect to the socket of the instance that serves it. Leave `home.path` out to accept whichever home the instance serves.

## Hint

Connect to the instance for the home you expect, or start it with `--home` set to that home.
