---
code: MOSTRA_RUNTIME_WORKER_PARKED
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_RUNTIME_WORKER_PARKED

Artifact server code keeps crashing. Severity: error. Phase: runtime.

## What it means

The artifact version's worker crashed more than 5 times in 10 minutes, so Mostra stopped starting it (FAILURE_MODEL §2). Calls, runs and live sources of that version answer this code until the park clears, and the shell tells the viewer that the artifact's server code keeps crashing.

## How to fix it

Find the cause in the message and the worker's output, fix it, and publish again: a new publish, `verify` or a restart of the instance clears the park.

## Hint

Fix the server code and publish again, which clears the park; the message names the last crash's cause.
