---
code: MOSTRA_ENV_BIND_FAILED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ENV_BIND_FAILED

Gateway can't bind. Severity: error. Phase: host.

## What it means

The gateway couldn't listen on the address it was given: `--bind` named an address no interface has, a wildcard bind came without `--url-host`, or the operating system refused the address. Mostra doesn't start rather than serve on an address nobody asked for.

## How to fix it

Omit `--bind` to serve on `127.0.0.1` only (the default). For a wider bind, pass an address of one of this machine's interfaces, and with `0.0.0.0` or `::` also `--url-host <name>`, the name viewers use to reach it.

## Hint

Start Mostra with an address this machine has, or without `--bind` to use the loopback address.
