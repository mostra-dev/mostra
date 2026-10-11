---
code: MOSTRA_MANIFEST_UNKNOWN_KEY
severity: warning
phase: manifest
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_MANIFEST_UNKNOWN_KEY

Unknown manifest key. Severity: warning. Phase: manifest.

## What it means

The manifest has a key this runtime doesn't know. Mostra ignores it, so manifests written for a newer release still publish, but a misspelled key (`familly`, `decription`) silently has no effect.

## How to fix it

Check the key against the manifest fields (`id`, `title`, `description`, `family`, `links`, `mode`, `submission`, `kit`, `terminals`, `demos`, `limits`, `verify`) and fix the spelling, or remove it.

## Hint

Remove the key or correct its spelling; a newer Mostra may support it.
