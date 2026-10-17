---
code: MOSTRA_LIVE_SOURCE_FAILED
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_LIVE_SOURCE_FAILED

Live source failed. Severity: error. Phase: runtime.

## What it means

A live source's `load` or `stream` threw, or its value was outside the serializable types. Pages keep showing the last good value with `useLive`'s `error` set, and the producer tries again on its schedule (FAILURE_MODEL §6).

## How to fix it

Fix the producer in `live.ts`, or catch transient failures there and return the previous value.

## Hint

Read the message, fix the live source's loader or stream, and publish again; the last good value stays meanwhile.
