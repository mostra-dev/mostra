/**
 * Where this system keeps the tunnel tools a share drives (D158 item 4): `tailscale` and
 * `cloudflared`, which Mostra never bundles or downloads. A daemon started by a login service may
 * run with a short `PATH`, so the tools' usual install locations are searched after it, and an
 * environment variable names one outright. How to install each is said here too, per system.
 */
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { OS, WINDOWS } from "./directories.ts";

/** A tunnel tool. */
export type TunnelTool = "tailscale" | "cloudflared";

/** The variable that names a tool's executable outright. */
const TOOL_VARIABLES: Readonly<Record<TunnelTool, string>> = {
  tailscale: "MOSTRA_TAILSCALE",
  cloudflared: "MOSTRA_CLOUDFLARED",
};

/** The usual install locations of each tool, per system, after `PATH`. */
export function usualLocations(
  tool: TunnelTool,
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  if (WINDOWS) {
    const programs = env["ProgramFiles"] ?? "C:\\Program Files";
    const programs86 = env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    return tool === "tailscale"
      ? [join(programs, "Tailscale", "tailscale.exe")]
      : [
          join(programs86, "cloudflared", "cloudflared.exe"),
          join(programs, "cloudflared", "cloudflared.exe"),
        ];
  }
  if (OS === "darwin") {
    return tool === "tailscale"
      ? [
          "/opt/homebrew/bin/tailscale",
          "/usr/local/bin/tailscale",
          // Homebrew's formula left unlinked (beside the Mac app, which owns the name), as found on
          // a real Mac in WP-13: its prefix keeps the command line all the same.
          "/opt/homebrew/opt/tailscale/bin/tailscale",
          "/usr/local/opt/tailscale/bin/tailscale",
          // The Mac app's own executable is its command line too.
          "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        ]
      : [
          "/opt/homebrew/bin/cloudflared",
          "/usr/local/bin/cloudflared",
          "/opt/homebrew/opt/cloudflared/bin/cloudflared",
          "/usr/local/opt/cloudflared/bin/cloudflared",
        ];
  }
  return tool === "tailscale"
    ? ["/usr/bin/tailscale", "/usr/local/bin/tailscale", "/usr/sbin/tailscale"]
    : ["/usr/bin/cloudflared", "/usr/local/bin/cloudflared"];
}

function executable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (!WINDOWS) accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The tool's executable: the variable's (which must exist), else the first on `PATH`, else the
 * first usual location that exists; `undefined` when there is none.
 */
function findTool(
  tool: TunnelTool,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const named = env[TOOL_VARIABLES[tool]];
  if (named !== undefined && named !== "") return executable(named) ? named : undefined;
  const names = WINDOWS ? [`${tool}.exe`] : [tool];
  const path = (WINDOWS ? (env["Path"] ?? env["PATH"]) : env["PATH"]) ?? "";
  for (const dir of path.split(delimiter)) {
    if (dir === "") continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (executable(candidate)) return candidate;
    }
  }
  return usualLocations(tool, env).find(executable);
}

/** How a tool runs: its executable and the arguments before the tool's own. */
export interface ToolCommand {
  readonly command: string;
  readonly args: readonly string[];
  /** Run by `MOSTRA_TEST_TUNNELS`: a local fake that forwards plain HTTP on loopback. */
  readonly fake: boolean;
}

/**
 * The variable that replaces both tools with local fakes for tests (`<dir>/tailscale.mjs` and
 * `<dir>/cloudflared.mjs`, run on this Node.js): the conformance kit's and the suites' own, which
 * forward on loopback as the real tools forward from their networks (STANDARDS: real side effects
 * in tests go to local fakes).
 */
const TEST_TUNNELS_VARIABLE = "MOSTRA_TEST_TUNNELS";

/** How to run a tool: {@link findTool}'s executable, or the test fake; `undefined` when missing. */
export function toolCommand(
  tool: TunnelTool,
  env: Readonly<Record<string, string | undefined>>,
): ToolCommand | undefined {
  const fakes = env[TEST_TUNNELS_VARIABLE];
  if (fakes !== undefined && fakes !== "") {
    const script = join(fakes, `${tool}.mjs`);
    return regularFile(script)
      ? { command: process.execPath, args: [script], fake: true }
      : undefined;
  }
  const found = findTool(tool, env);
  return found === undefined ? undefined : { command: found, args: [], fake: false };
}

function regularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** How to install a tool on this system, as one sentence. */
export function installHint(tool: TunnelTool): string {
  if (tool === "tailscale") {
    if (WINDOWS)
      return "Install Tailscale from https://tailscale.com/download/windows (or `winget install tailscale.tailscale`) and sign in.";
    if (OS === "darwin")
      return "Install Tailscale from https://tailscale.com/download/mac (or `brew install tailscale`) and sign in.";
    return "Install Tailscale with `curl -fsSL https://tailscale.com/install.sh | sh` (https://tailscale.com/download/linux), then run `sudo tailscale up`.";
  }
  if (WINDOWS)
    return "Install cloudflared with `winget install --id Cloudflare.cloudflared` (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).";
  if (OS === "darwin")
    return "Install cloudflared with `brew install cloudflared` (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).";
  return "Install cloudflared from your distribution's Cloudflare package repository or https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/.";
}
