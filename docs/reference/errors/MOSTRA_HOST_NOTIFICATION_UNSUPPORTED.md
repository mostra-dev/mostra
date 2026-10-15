---
code: MOSTRA_HOST_NOTIFICATION_UNSUPPORTED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOST_NOTIFICATION_UNSUPPORTED

Notification not accepted. Severity: error. Phase: host.

## What it means

Mostra sends a client only the notifications it listed in `mostra/initialize` (D84). This method would send one the client didn't list, such as `events/notify` for `events/subscribe`.

## How to fix it

Reconnect and initialize with `capabilities: { notifications: ["events/notify"] }`, or poll with `events/read` instead.

## Hint

List the notification in `capabilities.notifications` when you initialize.
