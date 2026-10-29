import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { ShareId } from "../../ids.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";
import { Share } from "./start.ts";

/**
 * The params of `share/stop` (INTERFACES §6, D158): one share, or every active share of an
 * artifact. Exactly one of the two is named; naming both or neither is `MOSTRA_HOST_INVALID_PARAMS`.
 */
export interface ShareStopParams {
  /** The share to stop. */
  readonly shareId?: string;
  /** Stops every active share of this artifact instead. */
  readonly artifact?: ArtifactRef;
  /** Makes retries idempotent: stopping is idempotent by itself, so a retry changes nothing. */
  readonly requestId?: string;
}

/** The result of `share/stop`: the shares it ended (none when they had ended already). */
export interface ShareStopResult {
  readonly stopped: readonly Share[];
}

const params: z.ZodType<ShareStopParams> = z
  .object({
    shareId: ShareId.schema.exactOptional(),
    artifact: ArtifactRef.exactOptional(),
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "ShareStopParams" });

const result: z.ZodType<ShareStopResult> = z
  .object({ stopped: z.array(Share).readonly() })
  .register(wireRegistry, { id: "ShareStopResult", description: "The shares that ended." });

/**
 * `share/stop`: ends a share, or every active share of an artifact (D158): its link is revoked, so
 * every session it gave answers 410, and its tunnel stops. Stopping a share that already ended
 * succeeds and stops nothing; an unknown share is `MOSTRA_SHARE_NOT_FOUND`.
 */
export const shareStopMethod: MethodDefinition<ShareStopParams, ShareStopResult> = defineMethod({
  method: "share/stop",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
