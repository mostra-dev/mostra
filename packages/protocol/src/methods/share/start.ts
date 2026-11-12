import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { CapabilityScope } from "../../capability.ts";
import { Duration } from "../../duration.ts";
import { ArtifactId, ShareId, TokenId } from "../../ids.ts";
import { ViewerSpec } from "../../interaction.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { RespondentSpec, ROSTER_MAX } from "../../team.ts";
import { wireRegistry } from "../../wire-registry.ts";
import { RespondentLink } from "../roster/add.ts";

/**
 * How a share reaches its viewers (D158): `tailnet` through Tailscale Serve, to the people of the
 * user's tailnet, who are known by name; `funnel` through Tailscale Funnel and `cloudflare`
 * through a Cloudflare quick tunnel, both public, where the link is all that admits a viewer.
 */
export type ShareVia = "tailnet" | "funnel" | "cloudflare" | "remote";

/** The Zod schema of the `ShareVia` type. */
export const ShareVia: z.ZodType<ShareVia> = z
  .enum(["tailnet", "funnel", "cloudflare", "remote"])
  .register(wireRegistry, {
    id: "ShareVia",
    description:
      "How a share reaches its viewers: tailnet, funnel or cloudflare, or remote: hosted on a remote server (D165).",
  });

/** The longest a public share (Funnel or Cloudflare) may last: 7 days (D158). */
export const PUBLIC_SHARE_MAX_TTL_MS: number = 7 * 24 * 60 * 60 * 1000;

/** How long a public share lasts when its `ttl` isn't given: 1 hour (D63 item 5, D158). */
export const PUBLIC_SHARE_DEFAULT_TTL: Duration = "1h";

/** The params of `share/start` (INTERFACES §6, D158). */
export interface ShareStartParams {
  /** The artifact to share; the link opens its latest version. */
  readonly artifact: ArtifactRef;
  /** The tunnel. A public one (`funnel`, `cloudflare`) is explicit: never a fallback. */
  readonly via: ShareVia;
  /** For `remote`: the server's API origin. Default: the home's default server (D165 item 15). */
  readonly server?: string;
  /**
   * How long the share and its link last, such as `30m` or `24h`. Public shares: 1 hour by
   * default, at most 7 days. Tailnet shares: until stopped, unless given.
   */
  readonly ttl?: Duration;
  /** What the share's link allows (D97). Default: every scope. */
  readonly scopes?: readonly CapabilityScope[];
  /**
   * The person the share's link acts for (D104). Absent: whoever the tailnet or a host's identity
   * port names, else the link's own viewer, never the home's local user (D158).
   */
  readonly viewer?: ViewerSpec;
  /**
   * People the artifact expects answers from through this share (D121, D168): they join the
   * roster of the home that holds the artifact's viewers (a remote share's hosted home), and each
   * gets a personal link at the share's address. On a remote server, `email` reaches the operator's
   * `invitations` port. Not with `viewer`.
   */
  readonly respondents?: readonly RespondentSpec[];
  /** Makes retries idempotent: a repeated `requestId` returns the same share (H-03). */
  readonly requestId?: string;
}

/** A share, as `share/start` and `share/list` report it. */
export interface Share {
  /** The share's ID, for `share/stop`. */
  readonly shareId: string;
  /** The artifact shared. */
  readonly artifactId: string;
  /** The tunnel. */
  readonly via: ShareVia;
  /**
   * The share's capability URL, at the tunnel's address. Holding it is the authorization (D06);
   * absent once the share ended, and in `share/list` when the home's key can no longer show it.
   */
  readonly url?: string;
  /** The tunnel's host name: the tailnet device's, or the quick tunnel's random one. */
  readonly hostname: string;
  /**
   * The address the artifact's frame is served at over the tunnel, while the share is active:
   * on a tailnet, the second port of this device that viewers must be allowed to reach.
   */
  readonly artifactOrigin?: string;
  /**
   * How the artifact's frame authenticates over this tunnel (D70): `cookie` where the shell and
   * the artifact are one site (Tailscale), `worker` where they are two (Cloudflare).
   */
  readonly mode: "cookie" | "worker";
  /** The share's link, for `view/rotate` and `view/revoke`. */
  readonly tokenId: string;
  /** When the share started (RFC 3339, UTC). */
  readonly startedAt: string;
  /** When the share and its link end, if they do. */
  readonly expiresAt?: string;
  /** `active` while it serves; `stopped` once it ended. */
  readonly state: "active" | "stopped";
  /** When it ended. */
  readonly stoppedAt?: string;
  /**
   * Why it ended: `stopped` (`share/stop`), `expired` (its TTL), `tunnel` (its tunnel ended and
   * couldn't be set up again), `restart` (a quick tunnel can't outlive its instance), or
   * `revoked` (its link was revoked).
   */
  readonly stopReason?: "stopped" | "expired" | "tunnel" | "restart" | "revoked" | (string & {});
}

const shareShape = {
  shareId: ShareId.schema,
  artifactId: ArtifactId.schema,
  via: ShareVia,
  url: z.string().min(1).exactOptional(),
  hostname: z.string().min(1),
  artifactOrigin: z.string().min(1).exactOptional(),
  mode: z.enum(["cookie", "worker"]),
  tokenId: TokenId.schema,
  startedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().exactOptional(),
  state: z.enum(["active", "stopped"]),
  stoppedAt: z.iso.datetime().exactOptional(),
  stopReason: z.string().min(1).exactOptional(),
};

/** The Zod schema of the `Share` type. */
export const Share: z.ZodType<Share> = z.object(shareShape).register(wireRegistry, {
  id: "Share",
  description: "A share: its tunnel, link, address, frame mode and lifetime.",
});

/**
 * The result of `share/start`: the share, with its link, and the personal link of every respondent
 * it named (D168).
 */
export type ShareStartResult = Share & {
  readonly url: string;
  readonly respondents?: readonly RespondentLink[];
};

const params: z.ZodType<ShareStartParams> = z
  .object({
    artifact: ArtifactRef,
    via: ShareVia,
    server: z
      .string()
      .regex(/^https?:\/\/[^/?#\s]+$/)
      .exactOptional(),
    ttl: Duration.exactOptional(),
    scopes: z.array(CapabilityScope).min(1).readonly().exactOptional(),
    viewer: ViewerSpec.exactOptional(),
    respondents: z.array(RespondentSpec).min(1).max(ROSTER_MAX).readonly().exactOptional(),
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "ShareStartParams" });

const result: z.ZodType<ShareStartResult> = z
  .object({
    ...shareShape,
    url: z.string().min(1),
    respondents: z.array(RespondentLink).readonly().exactOptional(),
  })
  .register(wireRegistry, {
    id: "ShareStartResult",
    description: "The share that started, with its capability URL.",
  });

/**
 * `share/start`: shares an artifact through a tunnel the instance drives (D158): Tailscale Serve
 * for the tailnet, or Tailscale Funnel or a Cloudflare quick tunnel for anyone with the link. It
 * answers once the tunnel serves, with a new link at the tunnel's address that works there only.
 * A missing or unready tool is a `MOSTRA_SHARE_*` diagnostic saying what to do.
 */
export const shareStartMethod: MethodDefinition<ShareStartParams, ShareStartResult> = defineMethod({
  method: "share/start",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
