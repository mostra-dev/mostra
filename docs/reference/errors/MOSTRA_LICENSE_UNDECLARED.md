---
code: MOSTRA_LICENSE_UNDECLARED
severity: warning
phase: manifest
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_LICENSE_UNDECLARED

Dependency license not declared. Severity: warning. Phase: manifest.

## What it means

A package the plugin brings has a license that needs an acknowledgment, and the manifest's `bundledLicenses` doesn't declare it, so the person installing sees only the package's own license field. Mostra still finds and discloses it from the installed packages.

## How to fix it

Add `{ "package": "<name>", "license": "<expression>", "summary": "…", "url": "…" }` to `bundledLicenses`.

## Hint

Declare the license in the plugin manifest's bundledLicenses, with a summary and a URL.
