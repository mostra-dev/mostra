---
code: MOSTRA_DEMO_UNKNOWN
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEMO_UNKNOWN

The page shows a demo its version doesn't declare. Severity: error. Phase: runtime.

## What it means

A `<WebDemo>` or `useDemo` names a demo that the version's manifest doesn't declare, so there is no build to show.

## How to fix it

Add the demo to `defineArtifact({ demos: { … } })` under that name, or fix the name the page uses.

## Hint

Declare the demo in the manifest's `demos`, or show one it declares.
