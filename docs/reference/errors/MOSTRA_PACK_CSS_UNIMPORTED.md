---
code: MOSTRA_PACK_CSS_UNIMPORTED
severity: warning
phase: compile
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PACK_CSS_UNIMPORTED

Item CSS not imported. Severity: warning. Phase: compile.

## What it means

The item brings CSS variables or rules, which Mostra wrote into a stylesheet of the artifact, but the artifact's entry doesn't import that stylesheet, so the page doesn't load them yet. Mostra writes into the stylesheet the entry imports when there is one (or the one `components.json` names), and creates `styles.css` otherwise.

## How to fix it

Add `import "./styles.css";` (the path the message names) to the artifact's entry, after any other stylesheet.

## Hint

Import the stylesheet this diagnostic names from the artifact's entry.
