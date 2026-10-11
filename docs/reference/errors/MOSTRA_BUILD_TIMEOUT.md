---
code: MOSTRA_BUILD_TIMEOUT
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_BUILD_TIMEOUT

Build timed out. Severity: error. Phase: compile.

## What it means

The build took longer than its limit (180 seconds) and was stopped. Nothing was published.

## How to fix it

Move large data files that are imported into code into `public/` and fetch them at run time, split very large modules, and remove unused imports of heavy libraries. Then publish again.

## Hint

Make the build smaller, for example by moving large data into `public/`, then publish again.
