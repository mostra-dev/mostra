---
code: MOSTRA_FIELD_CONFLICT
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_FIELD_CONFLICT

Field changed by another writer. Severity: error. Phase: runtime.

## What it means

Every write names the revision it was based on, and a field changed after it is a conflict, never overwritten silently (D22). `window.storage` writes end with the last write: on a conflict it writes again over the newer value, a few times. When another writer kept changing the field each time, the write is refused with this code, and the field keeps the other writer's value.

## How to fix it

Read the key again and write the new value. For a counter or a list that many viewers change at once, store each viewer's part under its own key (`votes.<viewer>`) and combine them when reading.

## Hint

Read the value again, then write it; for a value several writers change often, give each writer a field of its own.
