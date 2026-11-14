---
code: MOSTRA_LICENSE_ACCEPT_INVALID
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_LICENSE_ACCEPT_INVALID

Accepted license not understood. Severity: error. Phase: host.

## What it means

A value of `--accept-license` (or of the host's `licenses.accept`) is neither an SPDX license ID, nor a `LicenseRef-` reference, nor `*`.

## How to fix it

Copy the ID from the `MOSTRA_LICENSE_UNACCEPTED` diagnostic that asked for it.

## Hint

Pass a license ID such as LicenseRef-Remotion, or * for every license.
