---
code: MOSTRA_SHARE_TOOL_MISSING
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SHARE_TOOL_MISSING

Sharing tool not installed. Severity: error. Phase: host.

## What it means

A share drives a tunnel tool installed on this machine: `tailscale` for tailnet and Funnel shares, `cloudflared` for Cloudflare quick tunnels. Mostra never bundles or downloads them; it found none where it looks (`PATH`, the tool's usual install locations, or `MOSTRA_TAILSCALE` and `MOSTRA_CLOUDFLARED`). The message says how to install it on this system.

## How to fix it

Install the tool (Tailscale from tailscale.com/download, `cloudflared` from Cloudflare's downloads or a package manager), or point `MOSTRA_TAILSCALE` or `MOSTRA_CLOUDFLARED` at it, then share again.

## Hint

Install the tool the message names, then run the share again.
