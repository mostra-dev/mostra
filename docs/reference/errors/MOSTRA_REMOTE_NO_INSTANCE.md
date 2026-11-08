---
code: MOSTRA_REMOTE_NO_INSTANCE
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REMOTE_NO_INSTANCE

No owner instance connected. Severity: error. Phase: host.

## What it means

Creating, verifying and publishing from a chat host run on the account's default owner instance, through the relay (D165 item 5), and no default instance is connected to the server now. Reading tools (list, wait, results, state, docs, open) keep working.

## How to fix it

Start Mostra on the linked machine (`mostra daemon start`, or `mostra daemon install` to keep it running); link a machine first with `mostra login <server> --default`.

## Hint

Start Mostra on the machine linked to this account (mostra daemon start), then try again.
