---
code: MOSTRA_HYGIENE_TOKEN_INVALID
severity: error
phase: hygiene
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HYGIENE_TOKEN_INVALID

Unknown capability token. Severity: error. Phase: hygiene.

## What it means

The capability token or frame ticket matched nothing in this home: it was mistyped, cut short, belongs to another home or artifact, or the ticket was already used or expired (tickets last 60 seconds and work once). Over the host protocol, the token ID named in `view/revoke` or `view/rotate` doesn't exist. The gateway answers 401, and failed attempts count towards the rate limit.

## How to fix it

Copy the whole link again. An agent or host mints a fresh one with `view/url`; the shell gets a new frame ticket by reloading.

## Hint

Use the complete capability link Mostra gave you, or mint a new one with `view/url`.
