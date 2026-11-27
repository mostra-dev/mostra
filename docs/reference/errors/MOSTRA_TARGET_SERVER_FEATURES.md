---
code: MOSTRA_TARGET_SERVER_FEATURES
severity: warning
phase: publish
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_TARGET_SERVER_FEATURES

An export loses the page's server features. Severity: warning. Phase: publish.

## What it means

The export is the page's front end, and the page has server code: the actions, live producers and Submit the message names need Mostra's server, so in the export they show as unavailable where they sit and live values keep the value they had, marked as frozen. No server code, secret or server setting is in the export.

## How to fix it

Nothing, when a readable record of the page is what you want. Export a `snapshot` to keep the answers and state as they are, or a `bundle` for another Mostra home to run the actions; add `--strict` to make this an error in scripts.

## Hint

Keep the answers and state with `--as snapshot`, or the actions running with `--as bundle` and `mostra run`.
