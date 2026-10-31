---
code: MOSTRA_SHARE_TUNNEL_FAILED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SHARE_TUNNEL_FAILED

Tunnel failed. Severity: error. Phase: host.

## What it means

The tunnel tool started but didn't serve within its time, or stopped: the message quotes what it reported. A share whose tunnel ends and can't be set up again stops, and `mostra share list` shows why; a Cloudflare quick tunnel can't keep its address, so its share ends with it.

## How to fix it

Share again for a new link. A tailnet or Funnel share keeps its address across restarts of its tunnel; a Cloudflare quick tunnel gets a new one each time.

## Hint

Run the share again; if it fails the same way, check the tool's message and this machine's network.
