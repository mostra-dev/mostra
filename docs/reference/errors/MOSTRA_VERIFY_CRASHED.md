---
code: MOSTRA_VERIFY_CRASHED
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_VERIFY_CRASHED

Verify runner crashed. Severity: error. Phase: runtime.

## What it means

The verify runner, the child process that drives the browser, stopped before it finished (FAILURE_MODEL §2). The message carries its last lines of output. Nothing was published, and the next verify starts a fresh runner.

## How to fix it

Verify again. A crash that repeats for the same artifact can come from a page that exhausts the browser's memory; one that repeats for every artifact means the runtime's browser is damaged.

## Hint

Verify again; if it keeps crashing, report the message with `mostra doctor`'s output.
