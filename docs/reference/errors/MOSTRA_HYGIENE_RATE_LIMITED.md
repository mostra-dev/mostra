---
code: MOSTRA_HYGIENE_RATE_LIMITED
severity: error
phase: hygiene
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HYGIENE_RATE_LIMITED

Too many failed attempts. Severity: error. Phase: hygiene.

## What it means

More than 30 capability tokens failed for this artifact within a minute, so the gateway refuses every token for it, valid ones included, until the minute has passed. A guess can't succeed while the limit holds, and only this artifact's links wait. The gateway answers 429 with `Retry-After`.

## How to fix it

Wait, then open the link again. Repeated failures usually come from a mistyped link or a script retrying an old one.

## Hint

Wait for the time in `Retry-After`, then open the link again.
