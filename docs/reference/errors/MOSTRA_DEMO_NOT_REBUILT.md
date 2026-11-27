---
code: MOSTRA_DEMO_NOT_REBUILT
severity: warning
phase: publish
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEMO_NOT_REBUILT

A demo couldn't be rebuilt for the export's base. Severity: warning. Phase: publish.

## What it means

`--base` rebuilds each demo under the export's path, which needs the demo's source exactly as the version built it. This demo's source isn't there, or has changed since, so the export carries the demo as the version built it, which works fully at a host's root only.

## How to fix it

Publish the artifact again with the demo's current source and export that version, or serve the export at a host's root.

## Hint

Export from the machine that built the version, with the demo's source as it was, or export without `--base`.
