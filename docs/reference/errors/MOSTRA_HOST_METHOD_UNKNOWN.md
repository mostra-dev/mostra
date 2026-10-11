---
code: MOSTRA_HOST_METHOD_UNKNOWN
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOST_METHOD_UNKNOWN

Unknown protocol method. Severity: error. Phase: host.

## What it means

The instance doesn't serve the method that was called. Either the name is misspelled, or the client is newer than the instance and calls a method the instance's release doesn't have.

## How to fix it

Check the method name against INTERFACES §6, and against `capabilities.methods` in the `mostra/initialize` result, which lists every method this instance serves. Upgrade the instance if the client needs a newer method.

## Hint

Call only the methods listed in `capabilities.methods` of the `mostra/initialize` result.
