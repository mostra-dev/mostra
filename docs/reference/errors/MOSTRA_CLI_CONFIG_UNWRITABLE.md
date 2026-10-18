---
code: MOSTRA_CLI_CONFIG_UNWRITABLE
severity: error
phase: platform
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_CLI_CONFIG_UNWRITABLE

The CLI's config directory can't be written. Severity: error. Phase: platform.

## What it means

`mostra telemetry on` and `off` record the choice in the CLI's config directory (`MOSTRA_CONFIG_DIR`, else `${XDG_CONFIG_HOME:-~/.config}/mostra`). The directory or its `telemetry.json` can't be written (another user owns it, the disk is full, it's read-only), so the choice wasn't recorded and nothing changed. Telemetry never stops another command for this: a store that can't be written means nothing is sent.

## How to fix it

Fix the directory's owner or mode, or set `MOSTRA_CONFIG_DIR` to a directory you own, and run the command again. `DO_NOT_TRACK=1` or `MOSTRA_TELEMETRY=0` in your environment turn telemetry off without a file.

## Hint

Make the directory the message names yours and writable (or point MOSTRA_CONFIG_DIR at one that is), then run the command again; DO_NOT_TRACK=1 turns telemetry off without writing anything.
