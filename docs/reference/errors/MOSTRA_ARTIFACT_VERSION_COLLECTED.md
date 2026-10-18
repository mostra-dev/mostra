---
code: MOSTRA_ARTIFACT_VERSION_COLLECTED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ARTIFACT_VERSION_COLLECTED

Version collected. Severity: error. Phase: host.

## What it means

`mostra gc` removed this version's files because nothing referenced it (D140). Its ID and number stay in the ledger forever, so history and events still name it, but it can't be opened or linked.

## How to fix it

Open a version that still exists (`artifact/get` marks collected ones), or publish the exact source of this version again: publish restores its files under the same ID and number.

## Hint

Open the artifact's latest version, or publish this version's source again to restore its files.
