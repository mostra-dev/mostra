---
code: MOSTRA_LINT_API_CHANGED
severity: warning
phase: lint
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_LINT_API_CHANGED

An API changed in a recent major release. Severity: warning. Phase: lint.

## What it means

A library the page uses changed this API in a recent major release, and the page uses the old form: an import that moved (`framer-motion`, `react-router-dom`, `reactflow`, TanStack Table 8's `useReactTable`), a call that is deprecated (Zod 3's `z.string().email()`, Mermaid's `init`), or a Tailwind CSS 3 class or directive that Tailwind CSS 4 writes another way, which does nothing now. Models trained before the release write the old form; it may still build, but it breaks or silently does nothing in the version Mostra ships.

## How to fix it

Each finding carries a machine-applicable fix with the new form: apply it, or run `mostra verify <artifact> --fix`, which applies every fix verify found and verifies again.

## Hint

Write the new form the fix shows, or run `mostra verify <artifact> --fix` to apply every such fix.
