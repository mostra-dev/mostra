---
code: MOSTRA_PUBLISH_VERIFY_FAILED
severity: error
phase: publish
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PUBLISH_VERIFY_FAILED

Verify found errors. Severity: error. Phase: publish.

## What it means

Publish runs verify (or reuses the verdict it cached for the same source and environment) and refuses when the verdict has errors (D41). The message lists their codes. Nothing was published. With `--force`, publish goes ahead and records the codes in the version, where hosts read them; a source that doesn't build can't be published either way.

## How to fix it

Fix the errors `mostra verify` reports and publish again, or publish with `--force` if the version must ship as it is.

## Hint

Run `mostra verify` to see the errors and fix them, or publish with `--force` to record them in the version.
