---
code: MOSTRA_CLI_UNKNOWN_COMMAND
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_CLI_UNKNOWN_COMMAND

Unknown command. Severity: error. Phase: host.

## What it means

The first word after `mostra` isn't a command this CLI has. The message lists the commands that exist. Commands that later releases add (sharing, export, plugins, terminals) appear only once they exist, never as placeholders.

## How to fix it

Run one of the listed commands. `mostra --help` lists every command with a one-line summary.

## Hint

Pick one of the commands this message lists; `mostra --help` describes each.
