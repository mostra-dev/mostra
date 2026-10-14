---
code: MOSTRA_HOST_REQUEST_ID_REUSED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOST_REQUEST_ID_REUSED

A requestId was reused with other parameters. Severity: error. Phase: host.

## What it means

A mutating method recorded its result under this `requestId` for different parameters. Replaying that result would answer a request nobody made (a link for another artifact or with other scopes, another source's publish), so the instance refuses (H-03). Retries with the same parameters still return the recorded result.

## How to fix it

Generate a fresh `requestId` for every new request, and reuse one only to retry the same request after a timeout or a lost connection.

## Hint

Send a new `requestId` for a new request; repeat the exact parameters only to retry one.
