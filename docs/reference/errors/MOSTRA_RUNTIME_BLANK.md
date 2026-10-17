---
code: MOSTRA_RUNTIME_BLANK
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_RUNTIME_BLANK

Page rendered nothing. Severity: error. Phase: runtime.

## What it means

After the page reported ready, no element had a visible box (text, image, SVG, canvas or video) and the screenshot was one uniform color. Usually the page threw during its first render, rendered nothing until data arrived, or hid everything with CSS.

## How to fix it

Look at the other diagnostics for an error during the first render, and make the page show content (or a loading state) right away.

## Hint

Make the page render something visible; check its first render and its imports.
