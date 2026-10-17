---
code: MOSTRA_SMOKE_NO_EFFECT
severity: warning
phase: smoke
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SMOKE_NO_EFFECT

Control showed no effect. Severity: warning. Phase: smoke.

## What it means

Verify's smoke test clicked, hovered or filled the control the message names, and saw no change: no change to the page, no request, no saved field and no navigation. Controls that are disabled or already active (the selected tab), and those that open on hover, are classified before this is judged. A control can still be fine: it may act on something verify can't observe.

## How to fix it

Use the control yourself. If it does what it should, nothing needs to change.

## Hint

Observed only: using this control changed nothing verify could see; check it by hand before changing working code.
