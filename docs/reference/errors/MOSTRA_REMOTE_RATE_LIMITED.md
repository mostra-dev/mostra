---
code: MOSTRA_REMOTE_RATE_LIMITED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REMOTE_RATE_LIMITED

Too many requests on this link. Severity: error. Phase: host.

## What it means

Too many requests of this kind came through one link or one address in a short time, past the server's `rateLimits`. Nothing was recorded, and a draft stays as it was.

## How to fix it

Wait for the `Retry-After` the answer carries and try again. The limits are the server's `rateLimits` settings.

## Hint

Try again after the time the answer's Retry-After gives.
