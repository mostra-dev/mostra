import * as z from "zod";
import { ArtifactId } from "../../ids.ts";
import { ViewerSpec } from "../../interaction.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/**
 * How a browser's request reached the gateway (D143 item 2): `local` on the gateway's own
 * address; `tailnet` through Tailscale Serve and `token` through a public share, where the link is
 * all that identifies the viewer (both WP-13). An open string on the wire, so a host meets a newer
 * value instead of a refusal.
 */
export type IdentityVia = "local" | "tailnet" | "token" | (string & {});

/** The params of `port/identity.resolve` (INTERFACES §7, D143 item 2). */
export interface PortIdentityResolveParams {
  /** The artifact whose link is being opened. */
  readonly artifactId: string;
  /** How the request reached the gateway. */
  readonly via: IdentityVia;
  /**
   * The request's headers, names in lower case, without `cookie` and without Mostra's own
   * `x-mostra-*` headers: what a host's proxy or tunnel added (an identity header) is here.
   */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * The result of `port/identity.resolve`: the person, as the host's stable key and display name
 * (one viewer of kind `host` per `ref`), or `null` for the standalone default.
 */
export type PortIdentityResolveResult = ViewerSpec | null;

const params: z.ZodType<PortIdentityResolveParams> = z
  .object({
    artifactId: ArtifactId.schema,
    via: z.string().min(1),
    headers: z.record(z.string(), z.string()),
  })
  .register(wireRegistry, {
    id: "PortIdentityResolveParams",
    description:
      "A browser opening a link without a viewer: the artifact, how the request arrived and its headers (no cookies, no Mostra headers).",
  });

const result: z.ZodType<PortIdentityResolveResult> = ViewerSpec.nullable().register(wireRegistry, {
  id: "PortIdentityResolveResult",
  description:
    "The person the session acts for, by the host's stable key, or null for the default.",
});

/**
 * `port/identity.resolve`: Mostra asks the host that registered the `identity` port who a browser
 * is when it opens a link minted without a viewer (D143 item 2), with 5 seconds to answer. A
 * failure, a timeout or an answer the schema refuses refuses the link's exchange with
 * `MOSTRA_HOST_IDENTITY_UNAVAILABLE`; it never falls back to another person.
 */
export const portIdentityResolveMethod: MethodDefinition<
  PortIdentityResolveParams,
  PortIdentityResolveResult
> = defineMethod({
  method: "port/identity.resolve",
  direction: "instance-to-host",
  mutating: false,
  params,
  result,
});
