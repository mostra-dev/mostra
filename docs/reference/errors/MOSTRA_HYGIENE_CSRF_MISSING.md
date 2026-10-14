---
code: MOSTRA_HYGIENE_CSRF_MISSING
severity: error
phase: hygiene
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HYGIENE_CSRF_MISSING

CSRF token missing or wrong. Severity: error. Phase: hygiene.

## What it means

Every request that changes state through a session carries the session's CSRF token in the `X-Mostra-CSRF` header. The token comes only from the session endpoint of the same origin, which no other page can read. A missing or different token is answered with 403.

## How to fix it

Read `csrf` from `GET /_mostra/session` (on the shell, `GET /a/<artifactId>/_mostra/session`) and send it with every POST. Mostra's client runtime and shell do this for you.

## Hint

Send the session's CSRF token from `GET /_mostra/session` in the `X-Mostra-CSRF` header.
