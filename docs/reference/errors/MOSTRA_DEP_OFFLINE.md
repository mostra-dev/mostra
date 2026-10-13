---
code: MOSTRA_DEP_OFFLINE
severity: error
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_DEP_OFFLINE

Package unavailable offline. Severity: error. Phase: compile.

## What it means

Mostra is offline (`MOSTRA_OFFLINE` is set, no network interface is up, or the registry can't be reached), and the artifact needs a package that the home's package store doesn't hold yet. Everything the store holds keeps working offline, including rebuilds of published versions. The message names the missing package.

## How to fix it

Publish again once the registry is reachable; the package then stays in the store for later offline use. Otherwise remove the import, or use a package from the warm set.

## Hint

Connect to the network and publish again, or import a package the home already holds.
