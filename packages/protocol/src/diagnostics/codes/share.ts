/**
 * Diagnostic codes of the SHARE area.
 */
import type { AreaCatalog } from "../spec.ts";

/** The codes of the SHARE area, in the order they were added. */
export const shareDiagnosticCodes = [
  "MOSTRA_SHARE_TOOL_MISSING",
  "MOSTRA_SHARE_TOOL_NOT_READY",
  "MOSTRA_SHARE_NOT_ENABLED",
  "MOSTRA_SHARE_PORTS_EXHAUSTED",
  "MOSTRA_SHARE_TUNNEL_FAILED",
  "MOSTRA_SHARE_NOT_FOUND",
  "MOSTRA_SHARE_TTL_INVALID",
  // gen:codes
] as const;

/** The codes of the SHARE area. */
export type ShareDiagnosticCode = (typeof shareDiagnosticCodes)[number];

/** The SHARE area's catalog entries. */
export const shareDiagnostics: AreaCatalog<ShareDiagnosticCode> = {
  MOSTRA_SHARE_TOOL_MISSING: {
    severity: "error",
    phase: "host",
    title: "Sharing tool not installed",
    hint: "Install the tool the message names, then run the share again.",
    docs: {
      explanation:
        "A share drives a tunnel tool installed on this machine: `tailscale` for tailnet and Funnel shares, `cloudflared` for Cloudflare quick tunnels. Mostra never bundles or downloads them; it found none where it looks (`PATH`, the tool's usual install locations, or `MOSTRA_TAILSCALE` and `MOSTRA_CLOUDFLARED`). The message says how to install it on this system.",
      fix: "Install the tool (Tailscale from tailscale.com/download, `cloudflared` from Cloudflare's downloads or a package manager), or point `MOSTRA_TAILSCALE` or `MOSTRA_CLOUDFLARED` at it, then share again.",
    },
  },
  MOSTRA_SHARE_TOOL_NOT_READY: {
    severity: "error",
    phase: "host",
    title: "Sharing tool not ready",
    hint: "Do what the message says to the tool, then run the share again.",
    docs: {
      explanation:
        "The tunnel tool is installed but can't serve yet: Tailscale isn't running or isn't signed in to a tailnet, or `cloudflared` exited before it opened a tunnel. The message quotes what the tool reported.",
      fix: "Start Tailscale and sign in (`tailscale up`), or check that `cloudflared` runs and this machine reaches Cloudflare, then share again.",
    },
  },
  MOSTRA_SHARE_NOT_ENABLED: {
    severity: "error",
    phase: "host",
    title: "Sharing not enabled on the tailnet",
    hint: "Open the address in the message as the tailnet's admin to turn the feature on, then run the share again.",
    docs: {
      explanation:
        "Tailscale Serve needs HTTPS certificates turned on for the tailnet, and Funnel needs the Funnel permission for this device. Tailscale refused the share and gave an address where an admin of the tailnet turns the feature on; the message carries it.",
      fix: "Open the address as an admin of the tailnet and approve, then share again. Without admin rights, ask the tailnet's admin, or share publicly through a Cloudflare quick tunnel (`mostra share <artifact> --public`).",
    },
  },
  MOSTRA_SHARE_PORTS_EXHAUSTED: {
    severity: "error",
    phase: "host",
    title: "No tunnel port free",
    hint: "Stop a share you no longer need (`mostra share list`, then `mostra share stop <share>`), or share through a Cloudflare quick tunnel.",
    docs: {
      explanation:
        "Tailscale Funnel listens only on ports 443, 8443 and 10000 of a device: Mostra gives 443 to the shell and the other two to one artifact each, so at most two artifacts are shared through Funnel at once. A port is also unavailable when this device's own Serve or Funnel configuration already uses it.",
      fix: "Stop one of the Funnel shares, free the port in Tailscale's own configuration, or share this artifact through a Cloudflare quick tunnel.",
    },
  },
  MOSTRA_SHARE_TUNNEL_FAILED: {
    severity: "error",
    phase: "host",
    title: "Tunnel failed",
    hint: "Run the share again; if it fails the same way, check the tool's message and this machine's network.",
    docs: {
      explanation:
        "The tunnel tool started but didn't serve within its time, or stopped: the message quotes what it reported. A share whose tunnel ends and can't be set up again stops, and `mostra share list` shows why; a Cloudflare quick tunnel can't keep its address, so its share ends with it.",
      fix: "Share again for a new link. A tailnet or Funnel share keeps its address across restarts of its tunnel; a Cloudflare quick tunnel gets a new one each time.",
    },
  },
  MOSTRA_SHARE_NOT_FOUND: {
    severity: "error",
    phase: "host",
    title: "Unknown share",
    hint: "List the home's shares with `mostra share list` and name one of them.",
    docs: {
      explanation: "No share of this home has the ID given, or the artifact has no share.",
      fix: "Use a share ID from `mostra share list`.",
    },
  },
  MOSTRA_SHARE_TTL_INVALID: {
    severity: "error",
    phase: "host",
    title: "Share lifetime refused",
    hint: "Give a public share a lifetime of at most 7 days, such as `--ttl 24h`.",
    docs: {
      explanation:
        "A public share (Funnel or Cloudflare) admits anyone holding its link, so it lasts 1 hour unless `ttl` says otherwise, and at most 7 days. Tailnet shares have no limit.",
      fix: "Use a `ttl` of 7 days or less, and share again when it ends, or share inside the tailnet.",
    },
  },
  // gen:entries
};
