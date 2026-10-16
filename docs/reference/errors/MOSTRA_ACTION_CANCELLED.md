---
code: MOSTRA_ACTION_CANCELLED
severity: warning
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ACTION_CANCELLED

Action run cancelled. Severity: warning. Phase: runtime.

## What it means

The action run was cancelled from a page, and its `abortSignal` fired. The run ends `cancelled` when the action stops; an action that ignores the signal ends with whatever it returns.

## How to fix it

Nothing to fix. Pass `abortSignal` from `@mostra/server` to `fetch` and other cancellable calls so cancelling stops the work.

## Hint

Start the action again if it should still run.
