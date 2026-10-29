/**
 * `mostra share`: an artifact opened to people beyond this machine through a tunnel the daemon
 * runs (D47, D158): `--tailnet` (Tailscale Serve, inside your tailnet, with each person's
 * identity) or `--public` (a Cloudflare quick tunnel by default, or Tailscale Funnel with `--via
 * funnel`), whose link expires (1 hour by default, 7 days at most). The share lives in the
 * daemon, so the command returns at once with the link; `share stop` ends it and `share list`
 * shows what is shared. A client of `share/start`, `share/stop` and `share/list`.
 */
import {
  type CapabilityScope,
  type Share,
  type ShareVia,
  shareListMethod,
  shareStartMethod,
  shareStopMethod,
} from "@mostra/protocol";
import { type CommandDef, defineCommand } from "../command.ts";
import { EXIT } from "../exit.ts";
import { usage } from "../parse.ts";
import { arg, artifactRef, flag } from "./shared.ts";

const SHARE_ID = /^shr_[0-9A-HJKMNP-TV-Z]{26}$/;

/** How each tunnel is named in human output. */
const THROUGH: Readonly<Record<ShareVia, string>> = {
  tailnet: "Tailscale Serve, inside your tailnet",
  funnel: "Tailscale Funnel, public",
  cloudflare: "a Cloudflare quick tunnel, public",
};

/** One share as a line of human output. */
function line(share: Share): string {
  const until =
    share.state === "stopped"
      ? `stopped${share.stopReason ? ` (${share.stopReason})` : ""}`
      : share.expiresAt
        ? `until ${share.expiresAt}`
        : "no expiry";
  return `${share.shareId}  ${share.via}  ${share.hostname}  ${until}`;
}

/** `mostra share <artifact> --tailnet | --public`. */
export const shareCommand: CommandDef = defineCommand({
  path: ["share"],
  summary:
    "Open an artifact to people beyond this machine: inside your tailnet, or publicly with a link that expires.",
  args: [{ name: "artifact", summary: "The artifact: its source path or its ID." }],
  flags: [
    {
      name: "tailnet",
      kind: "boolean",
      summary:
        "Share inside your tailnet through Tailscale Serve; each viewer is their tailnet identity.",
    },
    {
      name: "public",
      kind: "boolean",
      summary: "Share publicly: anyone with the link can open it until it expires.",
    },
    {
      name: "via",
      kind: "string",
      value: "<tunnel>",
      choices: ["cloudflare", "funnel"],
      default: "cloudflare",
      summary:
        "The public tunnel: a Cloudflare quick tunnel (no account), or Tailscale Funnel (shows your device's tailnet name).",
    },
    {
      name: "ttl",
      kind: "duration",
      value: "<d>",
      summary: "How long the link works, such as 30m or 24h. Public: 1h by default, 7d at most.",
    },
    {
      name: "scope",
      kind: "list",
      value: "<a,b>",
      summary: "The link's scopes: view, draft, submit, review, signal, action:*. Default: all.",
    },
    {
      name: "viewer",
      kind: "string",
      value: "<ref>",
      summary:
        "The person the link is for, by your own stable key for them; without it, each link is a viewer of its own.",
    },
    {
      name: "viewer-name",
      kind: "string",
      value: "<name>",
      summary: "The display name of --viewer.",
    },
    {
      name: "request-id",
      kind: "string",
      value: "<id>",
      summary: "Make a retried share return the same share instead of opening another.",
    },
  ],
  output: { type: "ShareStartResult", topic: "cli" },
  exits: [EXIT.failure, EXIT.environment],
  example: "share ./sidebar-review --public --ttl 2h",
  async run(context) {
    const artifact = artifactRef(arg(context, "artifact"), context.cwd);
    const tailnet = context.flags["tailnet"] === true;
    const publicly = context.flags["public"] === true;
    if (tailnet === publicly) throw usage("Give --tailnet or --public.");
    const viaFlag = flag(context, "via");
    if (viaFlag !== undefined && !publicly)
      throw usage("--via chooses a public tunnel: add --public.");
    const via: ShareVia = tailnet ? "tailnet" : viaFlag === "funnel" ? "funnel" : "cloudflare";
    const ttl = flag(context, "ttl");
    const scopes = context.flags["scope"] as readonly string[] | undefined;
    const viewerRef = flag(context, "viewer");
    const viewerName = flag(context, "viewer-name");
    const requestId = flag(context, "request-id");
    if (viewerName !== undefined && viewerRef === undefined)
      throw usage("--viewer-name needs --viewer.");
    const share = await context.call(shareStartMethod, {
      artifact,
      via,
      ...(ttl !== undefined ? { ttl: ttl as `${number}${"s" | "m" | "h" | "d"}` } : {}),
      ...(scopes !== undefined ? { scopes: scopes as CapabilityScope[] } : {}),
      ...(viewerRef !== undefined
        ? { viewer: { ref: viewerRef, ...(viewerName !== undefined ? { name: viewerName } : {}) } }
        : {}),
      ...(requestId !== undefined ? { requestId } : {}),
    });
    context.record({ event: "share.done", fields: { kind: via } });
    const until = share.expiresAt ? `until ${share.expiresAt}` : "until you stop it";
    return {
      result: share,
      human: `${share.url}\nShared through ${THROUGH[via]}, ${until}.\nStop it with: mostra share stop ${share.shareId}\n`,
    };
  },
});

/** `mostra share stop <artifact|shareId>`. */
export const shareStopCommand: CommandDef = defineCommand({
  path: ["share", "stop"],
  summary:
    "Stop a share, or every share of an artifact: its link stops working and its tunnel closes.",
  args: [{ name: "target", summary: "A share's ID (shr_…), or an artifact's source path or ID." }],
  flags: [],
  output: { type: "ShareStopResult", topic: "cli" },
  exits: [EXIT.failure, EXIT.environment],
  example: "share stop ./sidebar-review",
  async run(context) {
    const target = arg(context, "target");
    const result = await context.call(
      shareStopMethod,
      SHARE_ID.test(target) ? { shareId: target } : { artifact: artifactRef(target, context.cwd) },
    );
    return {
      result,
      human:
        result.stopped.length === 0
          ? "Nothing was shared.\n"
          : result.stopped.map((share) => `Stopped ${share.shareId}\n`).join(""),
    };
  },
});

/** `mostra share list [artifact] [--all]`. */
export const shareListCommand: CommandDef = defineCommand({
  path: ["share", "list"],
  summary: "List the active shares, of every artifact or of one; --all adds the ones that ended.",
  args: [
    {
      name: "artifact",
      summary: "Only this artifact's shares: its source path or ID.",
      optional: true,
    },
  ],
  flags: [{ name: "all", kind: "boolean", summary: "Also list shares that ended, and why." }],
  output: { type: "ShareListResult", topic: "cli" },
  exits: [EXIT.failure],
  example: "share list --all",
  async run(context) {
    const given = context.args["artifact"];
    const result = await context.call(shareListMethod, {
      ...(typeof given === "string" ? { artifact: artifactRef(given, context.cwd) } : {}),
      ...(context.flags["all"] === true ? { all: true } : {}),
    });
    return {
      result,
      human:
        result.shares.length === 0
          ? "Nothing is shared.\n"
          : `${result.shares.map((share) => line(share)).join("\n")}\n`,
    };
  },
});
