---
code: MOSTRA_HYGIENE_NOT_SERVED
severity: error
phase: hygiene
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HYGIENE_NOT_SERVED

Nothing served here. Severity: error. Phase: hygiene.

## What it means

The gateway serves only published versions' client files and the browser-protocol paths under `/_mostra/`. Everything else in the home, such as sources, server bundles, staging and unpublished builds, has no URL. A path or method nothing answers gets 404 or 405.

## How to fix it

Check the path. Server code runs through the browser protocol, never as a file, and an artifact becomes viewable only once it is published.

## Hint

Request a published version's files or a documented `/_mostra/` path.
