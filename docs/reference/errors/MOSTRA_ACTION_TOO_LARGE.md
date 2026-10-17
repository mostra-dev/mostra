---
code: MOSTRA_ACTION_TOO_LARGE
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ACTION_TOO_LARGE

Server function arguments or result too large. Severity: error. Phase: runtime.

## What it means

A server function's serialized arguments, or an action run's serialized result, is over 16 MiB. A plain call or run with arguments that large is refused before it starts; a run whose result grows past the limit is stopped and ends `failed`.

## How to fix it

Send identifiers rather than whole documents, return a page of results at a time, or publish large data through a live source or artifact state, which the page reads on its own.

## Hint

Return or pass less data: page through it, or write it to artifact state or a live source instead.
