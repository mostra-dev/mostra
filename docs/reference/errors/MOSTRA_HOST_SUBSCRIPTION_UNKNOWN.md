---
code: MOSTRA_HOST_SUBSCRIPTION_UNKNOWN
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOST_SUBSCRIPTION_UNKNOWN

Unknown subscription. Severity: error. Phase: host.

## What it means

The subscription ID belongs to no subscription on this connection: it was never created here, was ended with `events/unsubscribe`, or belonged to a connection that closed. Subscriptions live as long as their connection; a named subscriber's acknowledged cursor outlives it.

## How to fix it

Call `events/subscribe` again on this connection. With the same `name`, delivery resumes after the last acknowledged cursor.

## Hint

Subscribe again with `events/subscribe`, then use the ID it returns.
