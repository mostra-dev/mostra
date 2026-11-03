---
code: MOSTRA_ARTIFACT_ID_DROPPED
severity: warning
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ARTIFACT_ID_DROPPED

Manifest id removed. Severity: warning. Phase: host.

## What it means

A write replaced the artifact's entry (`index.tsx`, `index.jsx` or `index.mdx`) with text that no longer names the artifact ID its manifest held. Mostra wrote it as asked. An artifact without an `id` is bound to its source path at its first publish, so a page that was never published gets a new ID there, and one that was published keeps its ID only while its path stays the same: links, waits and results named by the old ID then don't find it.

## How to fix it

Add the `id` back, exactly as it was (`id: "art_01…"` in `defineArtifact`, or `id:` in the MDX frontmatter), with `artifact_patch` or `artifact_write`.

## Hint

Put the `id: "art_…"` line back into the entry's `defineArtifact` (or its frontmatter), or the next publish gives the artifact a new ID.
