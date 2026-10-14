import * as z from "zod";
import { TokenId } from "../../ids.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `view/revoke` (INTERFACES §6, D97). */
export interface ViewRevokeParams {
  /** The token whose link stops working. */
  readonly tokenId: string;
  /** Makes retries idempotent: a repeated `requestId` returns the recorded result (H-03). */
  readonly requestId?: string;
}

/** The result of `view/revoke`. */
export type ViewRevokeResult = Record<string, never>;

const params: z.ZodType<ViewRevokeParams> = z
  .object({
    tokenId: TokenId.schema,
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "ViewRevokeParams" });

const result: z.ZodType<ViewRevokeResult> = z
  .object({})
  .register(wireRegistry, { id: "ViewRevokeResult" });

/**
 * `view/revoke`: ends a capability link and every session opened with it; both answer 410 from
 * then on (HY-03). Revoking a revoked token succeeds; an unknown token is
 * `MOSTRA_HYGIENE_TOKEN_INVALID`.
 */
export const viewRevokeMethod: MethodDefinition<ViewRevokeParams, ViewRevokeResult> = defineMethod({
  method: "view/revoke",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
