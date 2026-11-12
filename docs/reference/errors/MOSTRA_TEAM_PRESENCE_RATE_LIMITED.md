---
code: MOSTRA_TEAM_PRESENCE_RATE_LIMITED
severity: error
phase: hygiene
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_TEAM_PRESENCE_RATE_LIMITED

Presence updates too fast. Severity: error. Phase: hygiene.

## What it means

A page shares its viewer's cursor and selection through `POST /_mostra/v/<rev>/presence`. Each view may send 20 updates a second; past that the gateway answers 429 with `Retry-After`. Presence is never stored, so nothing is lost: the next update replaces the last one.

## How to fix it

Use `usePresence` from `@mostra/react`, which sends at most 10 updates a second, or throttle your own calls to the route.

## Hint

Send presence at most 10 times a second; usePresence does this for you.
