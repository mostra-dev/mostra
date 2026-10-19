---
code: MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED
severity: error
phase: platform
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED

Runtime bundle download failed. Severity: error. Phase: platform.

## What it means

The runtime bundle for this release and platform isn't in the local cache yet, and fetching it failed: the network or a proxy refused it, the server answered with an error, the connection stalled for 60 seconds, or the disk ran out of space while it was written. Nothing partial is kept.

## How to fix it

Check the connection, and set `HTTPS_PROXY` (and `NO_PROXY`) when the network needs a proxy. Behind a firewall that blocks GitHub, host the release's files on a reachable server and set `MOSTRA_BUNDLE_MIRROR` to its base URL (a `file:` URL works for a local directory). Free space in the cache directory (`MOSTRA_CACHE_DIR`) if the message says the disk is full.

## Hint

Check the network or proxy (`HTTPS_PROXY`), then run the command again: a retry starts the download over.
