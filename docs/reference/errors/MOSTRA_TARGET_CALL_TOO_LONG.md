---
code: MOSTRA_TARGET_CALL_TOO_LONG
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_TARGET_CALL_TOO_LONG

A call outlasted the chat host's limit. Severity: error. Phase: runtime.

## What it means

A page shown inline in a chat host (an MCP App) reaches its server functions through the host's tool calls, which a host ends after about a minute. A plain call of a server function that hadn't finished within 45 seconds was stopped, and its result is lost: the function was asked to stop through its abort signal.

## How to fix it

Call long work through useAction instead of calling the function directly: an action run is recorded before it starts, goes on after the call that started it, and the page follows its progress and result. In the full page, plain calls have no such limit.

## Hint

Make work that can take longer than 45 seconds an action run (useAction): a run outlives the call and reports its progress.
