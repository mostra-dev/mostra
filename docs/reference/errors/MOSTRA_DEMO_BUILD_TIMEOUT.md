---
code: MOSTRA_DEMO_BUILD_TIMEOUT
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEMO_BUILD_TIMEOUT

A demo's build ran past its time limit. Severity: error. Phase: compile.

## What it means

A demo's build was still running when its time limit passed (10 minutes unless the demo's `timeout` says otherwise), so Mostra ended it and everything it started.

## How to fix it

Check that the build doesn't wait for input or watch files (a dev server never ends), then set a longer limit if it really needs one: `timeout: "20m"`.

## Hint

Make the build faster, or give the demo a longer `timeout` (at most 60m).
