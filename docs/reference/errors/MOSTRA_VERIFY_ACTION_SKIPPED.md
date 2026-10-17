---
code: MOSTRA_VERIFY_ACTION_SKIPPED
severity: hint
phase: smoke
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_VERIFY_ACTION_SKIPPED

Action skipped in verify. Severity: hint. Phase: smoke.

## What it means

Verify's smoke test never runs a server function that doesn't check `dryRun()` (D55). When the page called one, verify refused the call instead: the page's `run()` or server reference rejected with a `MostraError` carrying this code, as it would for any failed action. The verdict lists every such function in `smoke.skippedActions`. Nothing was sent, written or charged.

## How to fix it

Nothing is wrong. To have verify exercise the action, add `if (dryRun()) return <a representative result>;` before its side effects; verify then runs it with `dryRun()` true.

## Hint

To have verify run this action, check `dryRun()` from `@mostra/server` in it and return early without its side effects when it is true.
