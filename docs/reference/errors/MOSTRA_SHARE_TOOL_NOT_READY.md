---
code: MOSTRA_SHARE_TOOL_NOT_READY
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SHARE_TOOL_NOT_READY

Sharing tool not ready. Severity: error. Phase: host.

## What it means

The tunnel tool is installed but can't serve yet: Tailscale isn't running or isn't signed in to a tailnet, or `cloudflared` exited before it opened a tunnel. The message quotes what the tool reported.

## How to fix it

Start Tailscale and sign in (`tailscale up`), or check that `cloudflared` runs and this machine reaches Cloudflare, then share again.

## Hint

Do what the message says to the tool, then run the share again.
