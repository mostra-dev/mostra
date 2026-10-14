---
code: MOSTRA_HYGIENE_SESSION_CONFLICT
severity: warning
phase: hygiene
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HYGIENE_SESSION_CONFLICT

Another link is already open for this artifact. Severity: warning. Phase: hygiene.

## What it means

This browser already has a live session for the artifact from a different link. Opening a link never silently replaces it, because a page elsewhere could send the viewer to its own, narrower link and take over their tabs (D98). The shell shows both links' access and lets the viewer choose; the answer is 409 with `current` and `offered`.

## How to fix it

In the shell, choose the link to keep. A client exchanging tokens itself sends `replace: true` to replace the session.

## Hint

Choose which link to keep; send `replace: true` to use the new one.
