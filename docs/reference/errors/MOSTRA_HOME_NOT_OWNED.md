---
code: MOSTRA_HOME_NOT_OWNED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOME_NOT_OWNED

Directory not owned by you. Severity: error. Phase: host.

## What it means

Mostra keeps secrets, answers and its ledger in the home, and its control socket in a runtime directory, so it uses only directories that belong to the user running it. It reports this code when the home or the runtime directory is owned by another user, or when the path exists but isn't a directory. Mostra changes nothing in that case.

## How to fix it

Point Mostra at a directory you own: `--home <dir>` or `MOSTRA_HOME` for the home, `MOSTRA_RUNTIME_DIR` for the runtime directory. If the directory should be yours, change its owner with `chown`. Mostra tightens a directory you own to mode 0700 by itself.

## Hint

Choose a home you own with `--home` or `MOSTRA_HOME`, or give the directory named in the message back to your user with `chown`.
