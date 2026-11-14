---
code: MOSTRA_LICENSE_MISMATCH
severity: warning
phase: manifest
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_LICENSE_MISMATCH

Declared license differs. Severity: warning. Phase: manifest.

## What it means

The manifest declares a license for a package (in `bundledLicenses`, or its own `license`) that differs from the license field the package itself carries. Mostra discloses the package's own field, which it can read, and uses a declaration only where the field can't be read.

## How to fix it

Correct the declaration, or the package's license field if the declaration is right.

## Hint

Make the manifest's declaration match the package's own license field.
