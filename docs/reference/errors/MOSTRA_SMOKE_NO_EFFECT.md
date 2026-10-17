---
code: MOSTRA_SMOKE_NO_EFFECT
severity: warning
phase: smoke
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SMOKE_NO_EFFECT

Control showed no effect. Severity: warning. Phase: smoke.

## What it means

Verify's smoke test clicked or hovered the control the message names, once among the other controls and again after them, and saw no change either time: no change to the page, no request, no saved field, no navigation and no error. Controls that are disabled or already active (the selected tab) are skipped, and those that open on hover are hovered. A control can still be fine: it may act on something verify can't observe, such as the clipboard or a sound.

## How to fix it

Read the control's handler. If it does what it should, nothing needs to change; if it is meant to change the page, look at why it doesn't.

## Hint

Observed only: using this control twice changed nothing verify could see; a control that acts on something verify can't observe needs no change.
