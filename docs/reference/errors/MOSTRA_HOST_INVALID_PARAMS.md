---
code: MOSTRA_HOST_INVALID_PARAMS
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOST_INVALID_PARAMS

Invalid method params. Severity: error. Phase: host.

## What it means

The request's `params` don't match the method's published schema: a required field is missing, a value has the wrong type, or a value is outside its allowed range. The message names the first problem found.

## How to fix it

Compare the request with the method's schema in `@mostra/protocol` (or the published JSON Schema) and correct the field named in the message.

## Hint

Fix the params named in the message so they match the method's schema.
