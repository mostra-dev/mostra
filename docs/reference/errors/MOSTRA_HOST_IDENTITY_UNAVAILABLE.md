---
code: MOSTRA_HOST_IDENTITY_UNAVAILABLE
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOST_IDENTITY_UNAVAILABLE

The host that identifies viewers didn't answer. Severity: error. Phase: host.

## What it means

A host registered the `identity` port, so it decides who opens this home's links. When a link minted without a viewer was opened, that host failed, didn't answer within 5 seconds, gave an answer its schema refuses, or is expected (it lists `identity` in `HomeConfig.ports`) but not connected. Mostra refuses the link rather than let the session act as someone else.

## How to fix it

Start or reconnect the host, then open the link again. A link minted with `view/url`'s `viewer` names its person itself and never needs the port. To return the home to Mostra's own identity, have the host register without the port and clear its expected ports (`HomeConfig.ports: []`).

## Hint

Start the host that serves this home's identity port, then open the link again.
