---
code: MOSTRA_ENV_RUNTIME_INSTALLING
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ENV_RUNTIME_INSTALLING

Runtime still installing. Severity: error. Phase: host.

## What it means

`mostra mcp` installed from npm answers its client at once and installs its release's runtime bundle in the background on its first start (about 200 MB, D164 item 7), so a client's startup timeout never waits for the download. A tool that needs the instance waits for that install, up to 45 seconds per call; this call's time ran out first. The install goes on, and the message says how far it is. Tools that need no instance (`docs_search`, `artifact_write`, `artifact_patch`) work during it.

## How to fix it

Call the tool again once the install has had time to finish. When it fails instead, the next call says why (`MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED`, `MOSTRA_ENV_BUNDLE_UNAVAILABLE` offline) and starts it again.

## Hint

Call the tool again in a minute: Mostra keeps installing its runtime meanwhile.
