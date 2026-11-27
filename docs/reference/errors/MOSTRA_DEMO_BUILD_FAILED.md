---
code: MOSTRA_DEMO_BUILD_FAILED
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEMO_BUILD_FAILED

A demo's build failed. Severity: error. Phase: compile.

## What it means

The command a demo's `build` names ended with an error, or couldn't start. The message holds the build's last log lines. Nothing is published while a demo doesn't build.

## How to fix it

Run the same command in the demo's folder to see the whole log, fix what it reports (a missing install, a type error, a wrong script name), then verify again.

## Hint

Read the build's last lines in the message, fix the project, and verify again.
