---
code: MOSTRA_CLI_USAGE
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_CLI_USAGE

Command used wrongly. Severity: error. Phase: host.

## What it means

The command line didn't fit the command's definition: a missing or extra argument, an unknown flag, a flag without its value, or a value of the wrong form (a duration, a number, JSON). Nothing ran. In `--json` mode the error is the envelope's `error`, and the exit code is 2.

## How to fix it

Read `mostra <command> --help` (or `--help --json` for the machine-readable definition) and correct the arguments.

## Hint

Run `mostra <command> --help` for the command's arguments and flags, then run it again.
