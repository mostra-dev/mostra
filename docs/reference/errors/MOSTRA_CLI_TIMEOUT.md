---
code: MOSTRA_CLI_TIMEOUT
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_CLI_TIMEOUT

Command timed out. Severity: error. Phase: host.

## What it means

The command's `--timeout` passed before the instance answered. The CLI stopped waiting; the instance may still finish the request, and anything it committed stays committed (a publish, a state change). Exit code 4. `mostra wait` is different: its `--timeout` ends the wait with `still_waiting` and exit 5.

## How to fix it

Repeat the command with a longer `--timeout`. Mutating commands that take `--request-id` return the recorded result when repeated with the same ID.

## Hint

Run the command again with a longer `--timeout`, or without one; work it already committed keeps its IDs.
