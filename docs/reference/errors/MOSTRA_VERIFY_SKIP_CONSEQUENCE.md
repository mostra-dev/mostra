---
code: MOSTRA_VERIFY_SKIP_CONSEQUENCE
severity: hint
phase: smoke
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_VERIFY_SKIP_CONSEQUENCE

Page reaction to a skipped action. Severity: hint. Phase: smoke.

## What it means

After verify refused a server function that doesn't check `dryRun()`, the page reported an error: an unhandled rejection, an error a boundary caught, or a console error while it settled. It follows from verify's synthetic refusal, not from a defect a viewer would meet, so it is reported as a hint naming the skipped action.

## How to fix it

Nothing is required. To let verify see the action's real result, opt it into the smoke test with `dryRun()`.

## Hint

Nothing to fix: this followed from verify skipping an action, which a viewer's page never meets.
