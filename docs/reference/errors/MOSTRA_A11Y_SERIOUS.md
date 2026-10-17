---
code: MOSTRA_A11Y_SERIOUS
severity: warning
phase: a11y
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_A11Y_SERIOUS

Serious accessibility problem. Severity: warning. Phase: a11y.

## What it means

axe-core found a problem it rates critical or serious, such as a button with no accessible name or text with too little contrast. The message names axe's rule and the elements; `count` says how many.

## How to fix it

Follow the rule's advice for each element named, for example add an `aria-label` to an icon button.

## Hint

Read axe's description of the rule in the message; it names the elements it found.
