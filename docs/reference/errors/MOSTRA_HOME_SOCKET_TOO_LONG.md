---
code: MOSTRA_HOME_SOCKET_TOO_LONG
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOME_SOCKET_TOO_LONG

Control socket path too long. Severity: error. Phase: host.

## What it means

Clients reach an instance through a Unix socket in a per-user runtime directory. The operating system limits a socket path to 103 bytes on macOS and 107 on Linux, and the path Mostra computed is longer, usually because the home directory's path is long. Mostra stops instead of using a different place that clients couldn't find.

## How to fix it

Set `MOSTRA_RUNTIME_DIR` to a short directory you own, such as `/tmp/mostra-$USER`, in the environment of every Mostra client and host that uses this home. Mostra creates it with mode 0700 and re-creates its socket if a temporary-file cleanup removes it.

## Hint

Set `MOSTRA_RUNTIME_DIR` to a short directory you own, for example `/tmp/mostra-$USER`, and start again.
