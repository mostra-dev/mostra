---
code: MOSTRA_ACTION_INTERRUPTED
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ACTION_INTERRUPTED

Action run interrupted. Severity: error. Phase: runtime.

## What it means

The action run's worker crashed, ran out of memory, was stopped by the event-loop watchdog, or the instance stopped while the run was running. The run ends `failed` with the reason `interrupted`, and Mostra never retries it by itself (D24): an action that had already started a side effect, such as sending an email, may or may not have finished it.

## How to fix it

Look at the effect where it happens (the mail provider's sent folder, say) before running the action again. Pass the provider's own idempotency key from the action (for example, the run's key) so a repeated request can't act twice.

## Hint

Check the run's effects at their provider, then start it again with a new key if it should run again.
