---
code: MOSTRA_SHARE_NOT_ENABLED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SHARE_NOT_ENABLED

Sharing not enabled on the tailnet. Severity: error. Phase: host.

## What it means

Tailscale Serve needs HTTPS certificates turned on for the tailnet, and Funnel needs the Funnel permission for this device. Tailscale refused the share and gave an address where an admin of the tailnet turns the feature on; the message carries it.

## How to fix it

Open the address as an admin of the tailnet and approve, then share again. Without admin rights, ask the tailnet's admin, or share publicly through a Cloudflare quick tunnel (`mostra share <artifact> --public`).

## Hint

Open the address in the message as the tailnet's admin to turn the feature on, then run the share again.
