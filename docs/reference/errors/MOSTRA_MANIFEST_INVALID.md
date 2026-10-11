---
code: MOSTRA_MANIFEST_INVALID
severity: error
phase: manifest
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_MANIFEST_INVALID

Manifest value is invalid. Severity: error. Phase: manifest.

## What it means

The manifest was read, but a field has a value the manifest doesn't allow: a missing `title`, a wrong type, an `id` that isn't an artifact ID (`art_` followed by a ULID), a `mode` this runtime doesn't build (`spa` is the only one), or frontmatter that isn't valid YAML. The message names the field and what was expected.

## How to fix it

Correct the field the message names. Leave `id` out to let Mostra bind the artifact to its source path at first publish, or keep the `id` that `mostra new` wrote. Every field except `title` is optional.

## Hint

Fix the manifest field named in the message so it matches the manifest's documented shape.
