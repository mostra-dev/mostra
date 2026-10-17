---
code: MOSTRA_ACTION_UNKNOWN_FUNCTION
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ACTION_UNKNOWN_FUNCTION

No such server function in this version. Severity: error. Phase: runtime.

## What it means

The page called a server function ID (`<module path>#<export>`) that the version's server bundle doesn't export. Pages call only functions their own build references, so this means a page and a worker of different versions, or a request written by hand.

## How to fix it

Republish the artifact and reload the page. Call server functions by importing them from their `"use server"` module, never by ID.

## Hint

Publish the artifact again so the page and its server code come from the same version.
