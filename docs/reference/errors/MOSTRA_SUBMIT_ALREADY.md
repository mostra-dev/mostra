---
code: MOSTRA_SUBMIT_ALREADY
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SUBMIT_ALREADY

Already submitted. Severity: error. Phase: runtime.

## What it means

The artifact's submission policy is `once`, and a submission already closed this draft: for scope `per-artifact` any viewer's submission closes every draft, for `per-viewer` the viewer's own. A submission is immutable and final, so Mostra refuses a second one and further edits to the closed draft. The refusal carries the existing submission. A repeated submit of the same view at the same draft revision is not refused: it returns the original submission.

## How to fix it

Read the existing submission with `mostra results <artifact>`. When another round of answers is wanted, publish a new artifact linked to this one (`links: [{ rel: "round-of", artifact }]`), or have the host publish with the `epochs` policy.

## Hint

This artifact takes one submission, and it was made; read it with `mostra results`.
