---
code: MOSTRA_HOME_GC_INCOMPLETE
severity: warning
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOME_GC_INCOMPLETE

gc didn't finish a step. Severity: warning. Phase: host.

## What it means

`mostra gc` removes what nothing references in steps: version files, source snapshots, lock layouts, the package store, verify's caches and, when asked, events. One step failed (the message names it and why), so it left that step's files in place. Everything an earlier step removed is listed in the result, and the versions it collected stay collected. The home is consistent: what gc left is still recorded as there.

## How to fix it

Run `mostra gc` again; a failure that repeats names its cause in the message (for example, a file the user can't remove).

## Hint

Run `mostra gc` again: what this run removed is in its result, and the next run picks up what it left.
