---
code: MOSTRA_ENV_NODE_UNSUPPORTED
severity: error
phase: platform
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ENV_NODE_UNSUPPORTED

Node.js too old to start Mostra. Severity: error. Phase: platform.

## What it means

A `mostra` (or `npm create mostra`) installed from npm starts on the machine's Node.js only long enough to find its runtime bundle, then every Mostra process runs on the bundle's own Node.js (RT-01, D142). That start needs Node.js 22.19 or later, and this one is older, so Mostra stopped before loading anything.

## How to fix it

Upgrade the machine's Node.js to 22.19 or later, or run Mostra without npm: download the runtime bundle for your platform from the GitHub release, check it against `SHA256SUMS`, extract it, run its `bin/mostra-setup` once, then use its `bin/mostra`.

## Hint

Run `mostra` with Node.js 22.19 or later, or run the runtime bundle's own `bin/mostra`, which needs no Node.js.
