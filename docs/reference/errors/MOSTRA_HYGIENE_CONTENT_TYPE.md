---
code: MOSTRA_HYGIENE_CONTENT_TYPE
severity: error
phase: hygiene
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HYGIENE_CONTENT_TYPE

JSON content type required. Severity: error. Phase: hygiene.

## What it means

Requests that change state must have a JSON body. A form or plain-text body is something any website can send without asking the browser first, so the gateway refuses it with 415.

## How to fix it

Send `Content-Type: application/json` and a JSON body.

## Hint

Send the body as JSON with `Content-Type: application/json`.
