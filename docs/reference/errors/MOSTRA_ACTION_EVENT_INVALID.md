---
code: MOSTRA_ACTION_EVENT_INVALID
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ACTION_EVENT_INVALID

Host event type or payload invalid. Severity: error. Phase: runtime.

## What it means

Server code called `emit(type, payload)` from `@mostra/server` with a type that isn't `host.` followed by a name, or a payload that isn't JSON or is larger than 64 KiB. The event is not appended; `emit` throws.

## How to fix it

Use a type such as `host.reply-sent` and a small JSON payload. Put larger data in artifact state or a live source and send its key in the event.

## Hint

Name the event `host.<name>` with 1 to 64 letters, digits, `.`, `_` and `-`, and keep its payload JSON of at most 64 KiB.
