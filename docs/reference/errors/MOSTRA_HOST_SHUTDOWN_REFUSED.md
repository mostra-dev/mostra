---
code: MOSTRA_HOST_SHUTDOWN_REFUSED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOST_SHUTDOWN_REFUSED

Only the spawning host can stop this instance. Severity: error. Phase: host.

## What it means

An instance started by a host over stdio (`mostra host`) lives as long as that host's connection, so only the host may stop it with `mostra/shutdown`. A client that attached through the home's socket asked it to stop. A daemon (`mostra daemon`) accepts `mostra/shutdown` from every attached client (D87).

## How to fix it

Close your own connection when you are done. To stop the instance, stop the host that spawned it, or have the host send `mostra/shutdown` or close its stdio.

## Hint

Ask the host that started this instance to stop it, or end the connection you opened instead.
