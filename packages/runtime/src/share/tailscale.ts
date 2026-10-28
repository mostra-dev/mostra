/**
 * The Tailscale driver (D158 item 4): Tailscale Serve for tailnet shares and Funnel for public
 * ones, through foreground `tailscale serve` and `tailscale funnel` children, one per address.
 * A foreground configuration lives as long as its command, so a stopped or crashed share leaves
 * nothing exposed. The device's name comes from `tailscale status --json`; a port this device's
 * own configuration already uses is never taken over.
 */
import { createDiagnostic, RpcError } from "@mostra/protocol";
import type { Log } from "../log.ts";
import { findTool, installHint } from "../platform/index.ts";
import type { ProcessManager } from "../processes/index.ts";
import { type LineVerdict, runToCompletion, runTunnel, type Tunnel } from "./tunnel.ts";

/** Funnel's ports (VERIFIED_FACTS): the shell takes 443, two artifacts the others (D158 item 4). */
export const FUNNEL_SHELL_PORT = 443;
export const FUNNEL_ARTIFACT_PORTS: readonly number[] = [8443, 10000];

/** How long `tailscale serve` or `funnel` may take to serve. */
const SERVE_TIMEOUT_MS = 30_000;

/** What the driver needs. */
export interface TailscaleContext {
  readonly processes: ProcessManager;
  readonly log: Log;
  /** The environment the tool runs in (the artifact allowlist) and is looked up in. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** This device on its tailnet. */
export interface TailnetDevice {
  /** The tool's executable. */
  readonly tool: string;
  /** The device's MagicDNS name, such as `laptop.tail1234.ts.net`. */
  readonly hostname: string;
  /** The ports this device serves already (any configuration, its own or Mostra's). */
  readonly served: ReadonlySet<number>;
}

const missing = (): RpcError =>
  new RpcError(
    createDiagnostic("MOSTRA_SHARE_TOOL_MISSING", {
      message: `Tailscale isn't installed on this machine (no \`tailscale\` found). ${installHint("tailscale")}`,
    }),
  );

/** Finds Tailscale and this device, or explains what is missing. */
export async function tailnetDevice(context: TailscaleContext): Promise<TailnetDevice> {
  const tool = findTool("tailscale", context.env);
  if (!tool) throw missing();
  const status = await runToCompletion({
    processes: context.processes,
    kind: "tunnel-query",
    ownerRef: "tailscale",
    command: tool,
    args: ["status", "--json"],
    env: context.env,
    timeoutMs: 15_000,
    label: "Tailscale",
  });
  let parsed: {
    BackendState?: string;
    Self?: { DNSName?: string };
    CurrentTailnet?: { MagicDNSEnabled?: boolean };
  };
  try {
    parsed = JSON.parse(status.stdout) as typeof parsed;
  } catch {
    throw new RpcError(
      createDiagnostic("MOSTRA_SHARE_TOOL_NOT_READY", {
        message: `Tailscale didn't report its status: ${(status.stderr || status.stdout).trim().slice(0, 400) || `exit ${status.code}`}. Start Tailscale and sign in (\`tailscale up\`).`,
      }),
    );
  }
  if (parsed.BackendState !== "Running") {
    throw new RpcError(
      createDiagnostic("MOSTRA_SHARE_TOOL_NOT_READY", {
        message: `Tailscale is ${parsed.BackendState ?? "not running"} on this machine. Start it and sign in (\`tailscale up\`).`,
      }),
    );
  }
  const dns = parsed.Self?.DNSName?.replace(/\.$/, "").toLowerCase();
  if (!dns || parsed.CurrentTailnet?.MagicDNSEnabled === false) {
    throw new RpcError(
      createDiagnostic("MOSTRA_SHARE_NOT_ENABLED", {
        message:
          "This tailnet has MagicDNS off, which Tailscale Serve and Funnel need for the device's name. Turn it on in the tailnet's DNS settings (https://login.tailscale.com/admin/dns).",
      }),
    );
  }
  return { tool, hostname: dns, served: await servedPorts(context, tool) };
}

/** The ports this device's Serve and Funnel configuration uses now. */
async function servedPorts(context: TailscaleContext, tool: string): Promise<Set<number>> {
  const status = await runToCompletion({
    processes: context.processes,
    kind: "tunnel-query",
    ownerRef: "tailscale",
    command: tool,
    args: ["serve", "status", "--json"],
    env: context.env,
    timeoutMs: 15_000,
    label: "Tailscale",
  });
  const ports = new Set<number>();
  try {
    const config = JSON.parse(status.stdout || "{}") as {
      TCP?: Record<string, unknown>;
      Foreground?: Record<string, { TCP?: Record<string, unknown> }>;
    };
    for (const key of Object.keys(config.TCP ?? {})) ports.add(Number(key));
    for (const session of Object.values(config.Foreground ?? {})) {
      for (const key of Object.keys(session.TCP ?? {})) ports.add(Number(key));
    }
  } catch {
    // An unreadable configuration hides nothing Tailscale itself would refuse.
  }
  return ports;
}

/**
 * Reads `tailscale serve` and `funnel` output: they serve once they print where; a tailnet
 * without the feature prints the address where an admin turns it on, which the share reports.
 */
function serveReader(feature: "Serve" | "Funnel"): (line: string) => LineVerdict {
  let notEnabled = false;
  return (line) => {
    const text = line.trim();
    if (/not enabled on your tailnet|isn't enabled|is not enabled/i.test(text)) {
      notEnabled = true;
      return undefined;
    }
    const consent = /https:\/\/login\.tailscale\.com\/\S+/.exec(text);
    if (consent && notEnabled) {
      return {
        kind: "failed",
        diagnostic: createDiagnostic("MOSTRA_SHARE_NOT_ENABLED", {
          message: `Tailscale ${feature} isn't enabled for this device's tailnet. An admin of the tailnet turns it on at ${consent[0]}`,
        }),
      };
    }
    if (
      /^Available (within your tailnet|on the internet)/i.test(text) ||
      /Press Ctrl\+C to exit/i.test(text)
    ) {
      return { kind: "serving" };
    }
    if (/already|in use|conflict/i.test(text) && /port|serve|listen/i.test(text)) {
      return {
        kind: "failed",
        diagnostic: createDiagnostic("MOSTRA_SHARE_PORTS_EXHAUSTED", {
          message: `Tailscale refused the port: ${text.slice(0, 300)}`,
        }),
      };
    }
    if (/^(error|failed)|permission denied|access denied/i.test(text)) {
      return {
        kind: "failed",
        diagnostic: createDiagnostic("MOSTRA_SHARE_TOOL_NOT_READY", {
          message: `Tailscale ${feature} refused the share: ${text.slice(0, 300)}`,
        }),
      };
    }
    return undefined;
  };
}

/**
 * Serves `local` at `https://<device>:<port>` on the tailnet (`serve`) or on the internet
 * (`funnel`), until the tunnel is stopped.
 */
export function expose(
  context: TailscaleContext,
  device: TailnetDevice,
  input: {
    readonly feature: "serve" | "funnel";
    readonly port: number;
    readonly local: string;
    readonly ownerRef: string;
  },
): Promise<Tunnel> {
  const label = input.feature === "serve" ? "Tailscale Serve" : "Tailscale Funnel";
  return runTunnel({
    processes: context.processes,
    log: context.log,
    kind: `tunnel-${input.feature}`,
    ownerRef: input.ownerRef,
    command: device.tool,
    args: [input.feature, `--https=${input.port}`, input.local],
    env: context.env,
    read: serveReader(input.feature === "serve" ? "Serve" : "Funnel"),
    origin: tailnetOrigin(device.hostname, input.port),
    timeoutMs: SERVE_TIMEOUT_MS,
    label,
  });
}

/** `https://<device>` with the port only when it isn't 443, as a browser writes the origin. */
export function tailnetOrigin(hostname: string, port: number): string {
  return port === 443 ? `https://${hostname}` : `https://${hostname}:${port}`;
}
