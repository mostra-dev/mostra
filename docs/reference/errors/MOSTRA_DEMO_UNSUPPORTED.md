---
code: MOSTRA_DEMO_UNSUPPORTED
severity: error
phase: manifest
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEMO_UNSUPPORTED

A demo declared as a dev server. Severity: error. Phase: manifest.

## What it means

A demo in the manifest names a command to run or a port to attach to: a running dev server. Mostra shows demos as built front ends only, stored with the version, so a demo works the same for every viewer wherever the page is seen and never depends on a process on the author's machine.

## How to fix it

Replace the demo with its build: `demos: { app: { source: "../web", build: ["pnpm", "build"], output: "dist" } }`, and set the app's base to `process.env.MOSTRA_DEMO_BASE` (Vite's `base`, Next.js's `basePath` with `output: "export"`).

## Hint

Declare the demo as a build: `{ source, build, output }`, the folder of its source, the command that builds it and the folder the build writes.
