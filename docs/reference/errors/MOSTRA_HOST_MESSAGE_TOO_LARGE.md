---
code: MOSTRA_HOST_MESSAGE_TOO_LARGE
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOST_MESSAGE_TOO_LARGE

Message too large for the protocol. Severity: error. Phase: host.

## What it means

One host-protocol message is one line of JSON, and a line holds at most 64 Mi characters (`MAX_LINE_LENGTH`), so neither side buffers without bound. Mostra checks every message before it writes it: an answer that would be longer is replaced by this error, and a delivery whose envelope would be longer is recorded as undeliverable instead of being sent and retried forever.

## How to fix it

Read less per request (`events/read` with a smaller `limit`, `results/get` for one submission), and keep artifacts' values within the field and document limits.

## Hint

Ask for less at once: a specific submission, fewer events, or smaller values.
