---
code: MOSTRA_REMOTE_SIGN_IN_REQUIRED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_REMOTE_SIGN_IN_REQUIRED

This action needs a signed-in viewer. Severity: error. Phase: host.

## What it means

On a hosted link, an action that runs on the owner's machine, or a submission when the artifact asks for it, needs a viewer signed in (D159, D165 item 13). Nothing was recorded.

## How to fix it

Sign in with the page's Sign in. An owner who wants anyone with the link to run actions sets `hosted: { actions: "link" }` in the manifest (and `submissions: "link"` for answers).

## Hint

Sign in from the page's chrome, or have the owner allow this for anyone with the link.
