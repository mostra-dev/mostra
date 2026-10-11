---
code: MOSTRA_ACTION_EXPORT_INVALID
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ACTION_EXPORT_INVALID

Server module exports something other than an async function. Severity: error. Phase: compile.

## What it means

A module that starts with `"use server"` makes every export a server function the page can call. React's contract allows only async functions there. Mostra reports this code for any other export (a constant, a class, a non-async function, `export *`), naming the export.

## How to fix it

Make the function `async`, or move the value to a separate module without the directive and import it from both sides.

## Hint

Export only async functions from a "use server" module; move other exports to an ordinary module.
