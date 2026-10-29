/**
 * The Cloudflare driver (D158 item 4): a Cloudflare quick tunnel per face, `cloudflared tunnel
 * --url http://127.0.0.1:<port>`, which needs no account and gets a random `trycloudflare.com`
 * hostname. Each hostname is its own site (`trycloudflare.com` is a public suffix), so a share's
 * shell and artifact are cross-site and its frames use worker mode (D70). Quick tunnels hold every
 * response back until it ends, so pages long-poll (VERIFIED_FACTS, WP-13). A quick tunnel's
 * hostname dies with its process, so a Cloudflare share ends with its tunnel.
 */
import { Resolver } from "node:dns/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import type { Log } from "../log.ts";
import { installHint, type ToolCommand, toolCommand } from "../platform/index.ts";
import type { ProcessManager } from "../processes/index.ts";
import { type LineVerdict, runTunnel, type Tunnel } from "./tunnel.ts";

/** How long a quick tunnel may take to serve: registering and the hostname's first answer. */
const QUICK_TUNNEL_TIMEOUT_MS = 60_000;

/** What the driver needs. */
export interface CloudflareContext {
  readonly processes: ProcessManager;
  readonly log: Log;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** A directory of the home's cache for the tunnel's empty configuration file. */
  readonly cacheDir: string;
}

/** How `cloudflared` runs, or `MOSTRA_SHARE_TOOL_MISSING`. */
export function cloudflared(context: CloudflareContext): ToolCommand {
  const tool = toolCommand("cloudflared", context.env);
  if (!tool) {
    throw new RpcError(
      createDiagnostic("MOSTRA_SHARE_TOOL_MISSING", {
        message: `cloudflared isn't installed on this machine. ${installHint("cloudflared")}`,
      }),
    );
  }
  return tool;
}

/**
 * Reads `cloudflared`'s log: it names the quick tunnel's address in a banner, and serves once a
 * connection to Cloudflare's edge is registered.
 */
function quickTunnelReader(fake: boolean): (line: string) => LineVerdict {
  return (line) => {
    // The test fake's tunnels are sites of their own on loopback, as quick tunnels are.
    const local = fake ? /\b(http:\/\/[a-z0-9-]+\.localhost:\d+)\b/.exec(line) : null;
    if (local) return { kind: "origin", origin: (local[1] as string).toLowerCase() };
    const address = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)\b/i.exec(line);
    if (address)
      return { kind: "origin", origin: `https://${(address[1] as string).toLowerCase()}` };
    if (/Registered tunnel connection/i.test(line)) return { kind: "serving" };
    if (
      /failed to (request|create) quick tunnel|error unmarshaling QuickTunnel|429 Too Many Requests/i.test(
        line,
      )
    ) {
      return {
        kind: "failed",
        diagnostic: createDiagnostic("MOSTRA_SHARE_TUNNEL_FAILED", {
          message: `Cloudflare didn't open a quick tunnel: ${line.trim().slice(0, 300)}`,
        }),
      };
    }
    return undefined;
  };
}

/**
 * Opens a quick tunnel to `local`. It never reads the user's own `cloudflared` configuration (a
 * file with ingress rules would turn the quick tunnel off): it runs with an empty one of its own.
 */
export function quickTunnel(
  context: CloudflareContext,
  input: { readonly local: string; readonly ownerRef: string },
): Promise<Tunnel> {
  const tool = cloudflared(context);
  mkdirSync(context.cacheDir, { recursive: true, mode: 0o700 });
  const config = join(context.cacheDir, "cloudflared.yml");
  writeFileSync(
    config,
    "# Mostra's quick tunnels read no other configuration.\nno-autoupdate: true\n",
    { mode: 0o600 },
  );
  return runTunnel({
    processes: context.processes,
    log: context.log,
    kind: "tunnel-cloudflare",
    ownerRef: input.ownerRef,
    command: tool.command,
    args: [
      ...tool.args,
      "tunnel",
      "--config",
      config,
      "--no-autoupdate",
      "--metrics",
      "127.0.0.1:0",
      "--management-diagnostics=false",
      "--url",
      input.local,
    ],
    env: context.env,
    read: quickTunnelReader(tool.fake),
    timeoutMs: QUICK_TUNNEL_TIMEOUT_MS,
    label: "A Cloudflare quick tunnel",
  });
}

/**
 * Waits until a quick tunnel's hostname resolves at Cloudflare's own resolvers (1.1.1.1 and
 * 1.0.0.1), asked directly, past this machine's cache. A new `trycloudflare.com` name takes a few
 * seconds to appear, and a resolver that is asked too early caches the miss for many minutes
 * (observed: the link never opened on this machine after an early probe, WP-13), so neither this
 * machine nor a viewer's phone may ask before the name exists. Resolves `false` when the budget
 * runs out (a network that blocks outside resolvers): the share goes on, since a viewer's
 * resolver may still answer.
 */
export async function hostnameResolves(hostname: string, budgetMs: number): Promise<boolean> {
  const resolver = new Resolver({ timeout: 2_000, tries: 1 });
  resolver.setServers(["1.1.1.1", "1.0.0.1"]);
  const until = Date.now() + budgetMs;
  while (Date.now() < until) {
    try {
      const addresses = await resolver.resolve4(hostname);
      if (addresses.length > 0) return true;
    } catch {
      // Not there yet, or the resolvers can't be reached: ask again shortly.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}
