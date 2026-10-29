---
code: MOSTRA_SHARE_PORTS_EXHAUSTED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SHARE_PORTS_EXHAUSTED

No tunnel port free. Severity: error. Phase: host.

## What it means

Tailscale Funnel listens only on ports 443, 8443 and 10000 of a device: Mostra gives 443 to the shell and the other two to one artifact each, so at most two artifacts are shared through Funnel at once. A port is also unavailable when this device's own Serve or Funnel configuration already uses it.

## How to fix it

Stop one of the Funnel shares, free the port in Tailscale's own configuration, or share this artifact through a Cloudflare quick tunnel.

## Hint

Stop a share you no longer need (`mostra share list`, then `mostra share stop <share>`), or share through a Cloudflare quick tunnel.
