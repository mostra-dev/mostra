---
code: MOSTRA_DEMO_OUTPUT_MISSING
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEMO_OUTPUT_MISSING

A demo's build wrote no page. Severity: error. Phase: compile.

## What it means

The demo's build succeeded, but the folder its `output` names holds no `index.html`, so there is nothing to show.

## How to fix it

Name the folder the build writes (Vite's `dist`, a Next.js static export's `out`) and make sure the build emits static files (Next.js needs `output: "export"`).

## Hint

Set the demo's `output` to the folder its build writes, which holds its `index.html`.
