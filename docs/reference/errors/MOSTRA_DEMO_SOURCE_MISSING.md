---
code: MOSTRA_DEMO_SOURCE_MISSING
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEMO_SOURCE_MISSING

A demo's source folder is missing. Severity: error. Phase: compile.

## What it means

The folder a demo's `source` names, resolved against the artifact's directory, doesn't exist or isn't a folder, so its build can't run.

## How to fix it

Fix the path in the manifest's `demos`, or move the project there.

## Hint

Point the demo's `source` at the folder of its project, relative to the artifact's directory.
