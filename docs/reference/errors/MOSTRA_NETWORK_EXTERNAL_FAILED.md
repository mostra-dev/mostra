---
code: MOSTRA_NETWORK_EXTERNAL_FAILED
severity: warning
phase: network
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_NETWORK_EXTERNAL_FAILED

Request to another origin failed. Severity: warning. Phase: network.

## What it means

A request the page made to another origin failed or answered 4xx or 5xx. It may be the environment (no network, a service that is down, a request the service refuses from this origin) rather than the code, so it is a warning.

## How to fix it

Check the URL and the service. If the page depends on it, show a fallback when it fails.

## Hint

A request to another origin failed while verify ran; check the URL and whether that service was reachable.
