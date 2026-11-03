---
code: MOSTRA_SUBMIT_NOT_FOUND
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SUBMIT_NOT_FOUND

No such submission. Severity: error. Phase: runtime.

## What it means

The artifact has no submission yet, or none with the ID asked for. Submissions are durable once made, so this means none was made (or the ID belongs to another artifact or home). An artifact whose submission policy is `none` never has one, and the message says so: its viewers' work is in its shared state, its signals and its action runs.

## How to fix it

Run `mostra wait <artifact> --until submitted` to block until the viewer submits, then read the results. List the artifact's submissions through `submission.created` events. Under policy `none`, read the shared state with `mostra state get <artifact>`, or wait for a signal the page raises with `mostra wait <artifact> --until signal:<name>`: its event carries the signal's payload.

## Hint

Wait for a submission with `mostra wait <artifact> --until submitted`, or, when the message says the policy is none, read `mostra state get <artifact>` or wait for a signal with `--until signal:<name>`.
