---
code: MOSTRA_HYGIENE_ORIGIN_REFUSED
severity: error
phase: hygiene
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HYGIENE_ORIGIN_REFUSED

Origin refused. Severity: error. Phase: hygiene.

## What it means

A request that changes state, opens a stream or upgrades to a WebSocket must carry an `Origin` header equal to the origin it is sent to. The gateway compares the strings exactly and answers 403 otherwise, so another website, or another artifact on a different port, can't drive this one.

## How to fix it

Call the gateway from the page it serves: the shell from the shell, the artifact from its own frame. Tools outside a browser send the listener's own origin.

## Hint

Send the request from the page's own origin.
