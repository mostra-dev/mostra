---
code: MOSTRA_KIT_THEME_CONTRAST
severity: warning
phase: lint
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_KIT_THEME_CONTRAST

Theme stack below contrast. Severity: warning. Phase: lint.

## What it means

The theme the stack makes has a text pair below WCAG 2.2 AA (text 4.5:1, a control's edge and the focus ring 3:1), as `defineTheme` checks every theme. Mostra builds it anyway: a page's look is its author's (D68).

## How to fix it

Change the colour the message names in the layer that sets it, so it meets the ratio on the ground it sits on.

## Hint

Observed only: check the colours this names, if the theme stack changed them on purpose.
