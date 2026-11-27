---
code: MOSTRA_DEMO_NOT_IN_FILE
severity: warning
phase: publish
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEMO_NOT_IN_FILE

A demo can't run inside a single file. Severity: warning. Phase: publish.

## What it means

The `html` export holds a page in one file, which can carry a demo only when its build is one graph of ES modules (Vite and most bundlers). This demo's build loads its scripts by URL (a Next.js export does), so the single file shows a note in its place, and the folder export carries it whole.

## How to fix it

Send the `static` export for this page, which opens from disk and carries every demo.

## Hint

Export the folder version instead: `mostra export <artifact> --as static`.
