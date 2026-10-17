---
code: MOSTRA_VERIFY_LIVE_FAILED
severity: warning
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_VERIFY_LIVE_FAILED

Live source failed during verify. Severity: warning. Phase: runtime.

## What it means

A live source's producer (`live.ts`) threw or couldn't reach its data while verify rendered the page. Verify runs producers for real, since they only read, so a failure can come from the environment (no network, a service that is down) as well as from the code. The page shows `useLive`'s `error` meanwhile.

## How to fix it

Read the message. If the producer itself is wrong, fix it; if the data source was unreachable, verify again when it is back.

## Hint

Check the live source's message: it failed while verify rendered the page, which may be the environment rather than the code.
