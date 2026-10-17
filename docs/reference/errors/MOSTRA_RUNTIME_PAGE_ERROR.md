---
code: MOSTRA_RUNTIME_PAGE_ERROR
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_RUNTIME_PAGE_ERROR

Uncaught error in the page. Severity: error. Phase: runtime.

## What it means

The artifact's page threw an error that nothing caught, or a promise rejected with nothing handling it, while verify rendered it or while the smoke test used a control (the message says which). A viewer's page would meet the same error.

## How to fix it

Find the stack's first frame in the artifact's code and fix the error there, or catch it where the page can recover.

## Hint

Fix the error the message names; it was thrown in the page and nothing caught it.
