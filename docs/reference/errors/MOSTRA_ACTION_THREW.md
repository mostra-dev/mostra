---
code: MOSTRA_ACTION_THREW
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ACTION_THREW

Server function threw. Severity: error. Phase: runtime.

## What it means

A server function threw while it ran. The page gets `{ code: "MOSTRA_ACTION_THREW", message }` with the thrown error's message (`useAction`'s `error`, or the rejected promise of a plain call); the stack goes to the action run's log, never to the page. When the error carried a diagnostic code of its own (a `MOSTRA_SECRET_MISSING`, say), that code is reported instead.

## How to fix it

Fix the cause in the function, or catch the error inside it and return a value the page can show. Mostra never retries a run by itself (D24); retry in your own code, or call the action again with a new key.

## Hint

Read the run's log for the stack, then fix the server function or catch the error and return a result instead.
