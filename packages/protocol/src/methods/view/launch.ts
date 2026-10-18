import * as z from "zod";
import { TokenId } from "../../ids.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `view/launch` (INTERFACES §6, D140 item 15). */
export interface ViewLaunchParams {
  /** The link whose session the launch URL opens: a `CapabilityLink.tokenId`. */
  readonly tokenId: string;
}

/** The result of `view/launch`. */
export interface ViewLaunchResult {
  /**
   * `http://<url host>:<shell port>/a/<artifactId>[/v/<number>]#l=<ticket>`: a URL to hand a
   * browser on its command line. The shell exchanges the single-use ticket for the session the
   * link would give; the link's secret is never in it.
   */
  readonly url: string;
  /** When the ticket stops working, 60 s after it was minted (RFC 3339, UTC). */
  readonly expiresAt: string;
}

const params: z.ZodType<ViewLaunchParams> = z
  .object({ tokenId: TokenId.schema })
  .register(wireRegistry, { id: "ViewLaunchParams" });

const result: z.ZodType<ViewLaunchResult> = z
  .object({ url: z.string().min(1), expiresAt: z.iso.datetime() })
  .register(wireRegistry, {
    id: "ViewLaunchResult",
    description: "A one-time launch URL for a browser.",
  });

/**
 * `view/launch`: a one-time launch URL for a link (D140 item 15), so a browser opens it without
 * the link's secret on a command line other local users can read. The ticket is single-use,
 * lives 60 s and carries 130 bits, like a frame ticket; it is never recorded, so the method takes
 * no `requestId`. A revoked or expired link is `MOSTRA_HYGIENE_TOKEN_REVOKED`.
 */
export const viewLaunchMethod: MethodDefinition<ViewLaunchParams, ViewLaunchResult> = defineMethod({
  method: "view/launch",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
