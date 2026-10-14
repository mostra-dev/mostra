import * as z from "zod";
import { TokenId } from "../../ids.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";
import { CapabilityLink } from "./url.ts";

/** The params of `view/rotate` (D97). */
export interface ViewRotateParams {
  /** The token to replace. */
  readonly tokenId: string;
  /** Makes retries idempotent: a repeated `requestId` returns the same new link (H-03). */
  readonly requestId?: string;
}

/** The result of `view/rotate`: the new link. */
export type ViewRotateResult = CapabilityLink;

const params: z.ZodType<ViewRotateParams> = z
  .object({
    tokenId: TokenId.schema,
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "ViewRotateParams" });

/**
 * `view/rotate`: replaces a capability link in one step. The new link has the same artifact,
 * scopes and expiry; the old one and its sessions answer 410 from then on. Rotating the artifact's
 * default link makes the new one its default. A revoked or expired token can't be rotated
 * (`MOSTRA_HYGIENE_TOKEN_REVOKED`).
 */
export const viewRotateMethod: MethodDefinition<ViewRotateParams, ViewRotateResult> = defineMethod({
  method: "view/rotate",
  direction: "client-to-instance",
  mutating: true,
  params,
  result: CapabilityLink,
});
