---
code: MOSTRA_CONSOLE_ERROR
severity: error
phase: console
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_CONSOLE_ERROR

Error logged to the console. Severity: error. Phase: console.

## What it means

The page logged an error with `console.error` while verify rendered it or used its controls. Errors caught by React error boundaries, the root's included, are logged this way. A viewer's page would log the same.

## How to fix it

Read the message and fix its cause in the artifact's code. Errors logged by a library usually name what it was given.

## Hint

Fix what the logged error describes; React logs errors its boundaries catch here too.
