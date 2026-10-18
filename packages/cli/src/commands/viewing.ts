/**
 * `mostra open`: the artifact's link on stdout, and a browser opened on a one-time launch URL that
 * never carries the link's secret (D140 item 15). A client of `view/default`, `view/url`,
 * `view/rotate`, `view/revoke` and `view/launch`.
 */
import { spawn } from "node:child_process";
import {
  type CapabilityLink,
  type CapabilityScope,
  viewDefaultMethod,
  viewLaunchMethod,
  viewRevokeMethod,
  viewRotateMethod,
  viewUrlMethod,
} from "@mostra/protocol";
import { type CommandContext, type CommandDef, defineCommand } from "../command.ts";
import { EXIT } from "../exit.ts";
import type { Environment } from "../home.ts";
import { usage } from "../parse.ts";
import { arg, artifactRef, flag } from "./shared.ts";

/** Whether this session can show a browser: not over SSH without a display. */
export function hasDisplay(env: Environment, platform: string = process.platform): boolean {
  const ssh = env["SSH_CONNECTION"] !== undefined || env["SSH_TTY"] !== undefined;
  if (platform === "darwin") return !ssh;
  return env["DISPLAY"] !== undefined || env["WAYLAND_DISPLAY"] !== undefined;
}

/**
 * Opens a URL in a browser: `$BROWSER` when set (the convention `xdg-open` follows too), else the
 * platform's opener, run with direct arguments, never through a shell.
 */
function openBrowser(url: string, env: Environment): boolean {
  const chosen = env["BROWSER"];
  const opener =
    chosen !== undefined && chosen !== ""
      ? chosen
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  try {
    const child = spawn(opener, [url], { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Whether `open` should launch a browser: a terminal without `--json`, or `--browser`. */
function wantsBrowser(context: CommandContext): boolean {
  if (context.flags["no-browser"] === true) return false;
  if (context.flags["browser"] === true) return true;
  return context.tty.stdout && !context.json && hasDisplay(context.env);
}

/** The link, opened in a browser when wanted. */
async function show(
  context: CommandContext,
  link: CapabilityLink,
): Promise<{ result: CapabilityLink & { readonly opened: boolean }; human: string }> {
  let opened = false;
  if (wantsBrowser(context)) {
    const launch = await context.call(viewLaunchMethod, { tokenId: link.tokenId });
    opened = openBrowser(launch.url, context.env);
  }
  return { result: { ...link, opened }, human: `${link.url}\n` };
}

/** `mostra open <artifact>`. */
export const openCommand: CommandDef = defineCommand({
  path: ["open"],
  summary:
    "Print an artifact's capability link and open it in a browser; or mint, rotate or revoke a link.",
  args: [{ name: "artifact", summary: "The artifact: its source path or its ID." }],
  flags: [
    {
      name: "new",
      kind: "boolean",
      summary: "Mint a separate link instead of the artifact's default one.",
    },
    {
      name: "version",
      kind: "string",
      value: "<n|id>",
      summary: "A new link that opens only this version.",
    },
    {
      name: "scope",
      kind: "list",
      value: "<a,b>",
      summary: "A new link's scopes: view, draft, submit, review, signal, action:*. Default: all.",
    },
    {
      name: "ttl",
      kind: "duration",
      value: "<d>",
      summary: "A new link that expires after this long, such as 24h.",
    },
    {
      name: "viewer",
      kind: "string",
      value: "<ref>",
      summary: "A new link that acts for this person, by your own stable key for them.",
    },
    {
      name: "viewer-name",
      kind: "string",
      value: "<name>",
      summary: "The display name of --viewer.",
    },
    {
      name: "rotate",
      kind: "string",
      value: "<tokenId>",
      summary: "Replace this link with a new one; the old one stops working.",
    },
    { name: "revoke", kind: "string", value: "<tokenId>", summary: "Stop this link from working." },
    { name: "browser", kind: "boolean", summary: "Open a browser even without a terminal." },
    { name: "no-browser", kind: "boolean", summary: "Only print the link." },
    {
      name: "request-id",
      kind: "string",
      value: "<id>",
      summary: "Make a retried --new return the same link.",
    },
  ],
  output: { type: "CapabilityLink", topic: "cli" },
  exits: [EXIT.failure],
  example: "open ./sidebar-review",
  async run(context) {
    const artifact = artifactRef(arg(context, "artifact"), context.cwd);
    const revoke = flag(context, "revoke");
    const rotate = flag(context, "rotate");
    if (revoke !== undefined && rotate !== undefined)
      throw usage("Give --rotate or --revoke, not both.");
    if (revoke !== undefined) {
      await context.call(viewRevokeMethod, { tokenId: revoke });
      return { result: { tokenId: revoke, revoked: true }, human: `Revoked ${revoke}\n` };
    }
    if (rotate !== undefined)
      return show(context, await context.call(viewRotateMethod, { tokenId: rotate }));
    const version = flag(context, "version");
    const scopes = context.flags["scope"] as readonly string[] | undefined;
    const ttl = flag(context, "ttl");
    const viewerRef = flag(context, "viewer");
    const viewerName = flag(context, "viewer-name");
    const requestId = flag(context, "request-id");
    if (viewerName !== undefined && viewerRef === undefined)
      throw usage("--viewer-name needs --viewer.");
    const fresh =
      context.flags["new"] === true ||
      version !== undefined ||
      scopes !== undefined ||
      ttl !== undefined ||
      viewerRef !== undefined;
    if (!fresh) return show(context, await context.call(viewDefaultMethod, { artifact }));
    const link = await context.call(viewUrlMethod, {
      artifact,
      ...(version !== undefined
        ? { version: /^[0-9]+$/.test(version) ? Number(version) : version }
        : {}),
      ...(scopes !== undefined ? { scopes: scopes as CapabilityScope[] } : {}),
      ...(ttl !== undefined ? { ttl: ttl as `${number}${"s" | "m" | "h" | "d"}` } : {}),
      ...(viewerRef !== undefined
        ? { viewer: { ref: viewerRef, ...(viewerName !== undefined ? { name: viewerName } : {}) } }
        : {}),
      ...(requestId !== undefined ? { requestId } : {}),
    });
    return show(context, link);
  },
});
