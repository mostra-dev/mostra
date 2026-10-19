---
code: MOSTRA_ENV_BUNDLE_INVALID
severity: error
phase: platform
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ENV_BUNDLE_INVALID

Runtime bundle failed verification. Severity: error. Phase: platform.

## What it means

Mostra checks every runtime bundle before it runs anything from it: the archive against the SHA-256 the installing package pins, then each extracted file against the bundle's own file list, and the verify browser against the bundle's browser pin. One of them differed, so the download was corrupted, changed on the way or replaced, and Mostra refused it. A bundle already installed that fails a later check (`mostra doctor --deep`) is refused the same way.

## How to fix it

Run the install again (`npm create mostra`, or the command that started it), which downloads a fresh copy. When a mirror is configured (`MOSTRA_BUNDLE_MIRROR`), check that it serves the release's files unchanged. Check a file you downloaded yourself against the release's `SHA256SUMS`, or with `gh attestation verify <file> --repo mostra-dev/mostra`.

## Hint

Nothing was installed; install Mostra again, and if it fails the same way, report it with the message.
