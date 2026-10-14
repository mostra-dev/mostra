---
code: MOSTRA_DEP_TIMEOUT
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEP_TIMEOUT

Package install timed out. Severity: error. Phase: compile.

## What it means

Installing the artifact's packages took longer than 300 seconds and was stopped. A slow registry, a stalled download or a lifecycle script that never ends are the usual causes. Nothing was published, and packages already in the store stay there.

## How to fix it

Publish again; packages that finished downloading aren't fetched twice. When a package's install script hangs, use another version of the package or another package.

## Hint

Check the network and the registry, then publish again.
