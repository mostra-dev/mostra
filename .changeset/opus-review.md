---
"@mostra/protocol": minor
"@mostra/runtime": minor
"@mostra/worker": minor
"@mostra/react": minor
---

Fixes from WP-08's Claude Opus review (D136). Arguments a page sends can't be registered symbols, async iterables, bigints of more than 10,000 digits or promises that never settle, and are checked before a run is recorded or a worker starts (`checkArgumentFrames`); a typed-array subclass such as `Buffer` crosses as its built-in base. A run whose action returned despite a cancel ends `succeeded` with its result. A page sees only its own viewer's signals from server code, no `host.*` event, `action.*` events only for runs it may see, and `worker.crashed` without its cause. An unknown function answers 404 before anything is recorded. A worker that dies during its start counts as one crash. Results and live values are redacted as values, bytes included; multi-line secrets line by line. A client key joins only a run of its own function. Live producers reconcile without scanning every artifact. Slow readers get coalesced run and live updates, pages render at most once per frame, and `runs/attach` takes `held` so a renewal reads only what is newer (`RunState.logFrom`, `batchFrom`). Migration 7 refuses replacing a run and changing its result batches.
