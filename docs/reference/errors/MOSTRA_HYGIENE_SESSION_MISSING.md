---
code: MOSTRA_HYGIENE_SESSION_MISSING
severity: error
phase: hygiene
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HYGIENE_SESSION_MISSING

No session. Severity: error. Phase: hygiene.

## What it means

The request carried no valid session for this origin. Sessions start when a capability link is opened: the shell exchanges the link's token for a session cookie, and gives the artifact frame a single-use ticket for its own. A session issued for another origin never counts, because every port of the host shares the browser's cookies. The gateway answers 401.

## How to fix it

Open the full capability link, including the part after `#`. A bookmark of the page without it works while the browser keeps the session cookie (400 days).

## Hint

Open the artifact's capability link again to start a session.
