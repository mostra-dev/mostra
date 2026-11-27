---
code: MOSTRA_DEMO_BASE_MISMATCH
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEMO_BASE_MISMATCH

A demo loads files from outside its base. Severity: error. Phase: compile.

## What it means

A page of the demo's build loads a file by a path outside the one the demo is served under, `/_mostra/demos/<name>/`, which Mostra gives the build as `MOSTRA_DEMO_BASE`. Served from the version, such a file would be missing.

## How to fix it

Read the base from the environment: in Vite `base: process.env.MOSTRA_DEMO_BASE`, in Next.js `basePath: process.env.MOSTRA_DEMO_BASE?.replace(/\/$/, "")`, and the same path as the router's basename.

## Hint

Build the demo with its base set to `process.env.MOSTRA_DEMO_BASE`.
