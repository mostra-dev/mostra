---
code: MOSTRA_HYGIENE_FRAME_SESSION
severity: error
phase: hygiene
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HYGIENE_FRAME_SESSION

Frame session couldn't start. Severity: error. Phase: hygiene.

## What it means

Where the shell and the artifact are two sites (a Cloudflare quick tunnel, or a host's addresses on two hosts), the artifact's frame can't use a cookie: it enters through a bootstrap page that installs Mostra's service worker at `/`, which signs every request of the frame (worker mode, D70). Mostra reports this code when that can't happen: the browser offers the frame no service worker (a private window, a setting that blocks third-party storage), refuses to install it, or the gateway refused the frame's entry. The client runtime reports it too when the artifact's own code registers another service worker at `/`, which would replace Mostra's and end the frame's session.

## How to fix it

Open the artifact through a tailnet or Funnel share, where the frame uses a cookie, or in a browser window that allows service workers in frames. An artifact that needs its own service worker registers it at a narrower scope than `/`.

## Hint

Open the artifact's tailnet or Funnel link, or this link in a normal window of another browser.
