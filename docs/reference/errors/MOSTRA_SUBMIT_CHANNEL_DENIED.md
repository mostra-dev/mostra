---
code: MOSTRA_SUBMIT_CHANNEL_DENIED
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SUBMIT_CHANNEL_DENIED

Submit channel not allowed. Severity: error. Phase: runtime.

## What it means

A submission comes through one of two channels (D40): the shell's trusted Submit (`shell`), which only a person can press, or the artifact's own code (`artifact`, `useSubmit().submit()` and `useChoice().choose()`). The host decides which it accepts (D108): through `HomeConfig.submitChannels` for the home, or its `trustedControls` port for each artifact. This view allows only the other channel, so Mostra refused the submit or the choice. `useSubmit().allowed` is `false` in such a view.

## How to fix it

Ask the viewer to press the shell's Submit (relabel it with `useSubmitControl`), and use `useChoice(id, { candidates })` to have the shell render a trusted Choose. Check `allowed` before showing an in-page submit button.

## Hint

Let the viewer submit with the shell's trusted Submit; this host doesn't take submissions from artifact code.
