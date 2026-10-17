---
code: MOSTRA_NETWORK_REQUEST_FAILED
severity: error
phase: network
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_NETWORK_REQUEST_FAILED

Request for the page's own resource failed. Severity: error. Phase: network.

## What it means

A resource the page loaded from the artifact's own origin (the document, a script, a style, an image, a font, or a fetch by artifact code) failed or answered 4xx or 5xx. Requests the browser makes on its own, such as `/favicon.ico`, and Mostra's own protocol aren't counted.

## How to fix it

Put the file in `public/` (served at the root) or import it from the code so the build includes it, and check the path's spelling.

## Hint

Check the path: a file the page loads from the artifact itself failed to load.
