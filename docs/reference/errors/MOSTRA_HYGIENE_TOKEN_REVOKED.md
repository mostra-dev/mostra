---
code: MOSTRA_HYGIENE_TOKEN_REVOKED
severity: error
phase: hygiene
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HYGIENE_TOKEN_REVOKED

Link revoked or expired. Severity: error. Phase: hygiene.

## What it means

The capability link was revoked (`view/revoke`), replaced (`view/rotate`), or reached the end of its `ttl`. Every session started from it ends too. The gateway answers 410. Local links have no expiry unless one was asked for.

## How to fix it

Get a new link from whoever shared this one. An agent mints it with `view/url`, or rotates the old one with `view/rotate`, and shares the new URL.

## Hint

Ask for a new link: `view/url` mints one, or `view/rotate` replaces this one.
