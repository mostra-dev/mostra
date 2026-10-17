import * as z from "zod";
import { LIVE_KEY_PATTERN } from "../../actions.ts";
import { ArtifactRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `live/push` (INTERFACES §6, D56). */
export interface LivePushParams {
  /** The artifact. */
  readonly artifact: ArtifactRef;
  /** The live source's key; a key `live.ts` doesn't define is created by the push. */
  readonly key: string;
  /** Any JSON, at most 4 MiB. */
  readonly value: unknown;
  /** `replace` (default): the new latest value. `append`: also kept in the source's ring. */
  readonly mode?: "replace" | "append";
  /** Makes retries idempotent: a repeated `requestId` returns the recorded result (H-03). */
  readonly requestId?: string;
}

/** The result of `live/push`. */
export interface LivePushResult {
  /** The value's revision. */
  readonly revision: string;
}

const params: z.ZodType<LivePushParams> = z
  .object({
    artifact: ArtifactRef,
    key: z.string().regex(LIVE_KEY_PATTERN),
    value: z.unknown(),
    mode: z.enum(["replace", "append"]).exactOptional(),
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, {
    id: "LivePushParams",
    description: "A value pushed into an artifact's live source.",
  }) as z.ZodType<LivePushParams>;

const result: z.ZodType<LivePushResult> = z
  .object({ revision: z.string() })
  .register(wireRegistry, { id: "LivePushResult", description: "The pushed value's revision." });

/**
 * `live/push`: writes a value into an artifact's live source (D56), which every open page reading
 * it receives at once. The latest value persists; updates are never stored as events (D63).
 */
export const livePushMethod: MethodDefinition<LivePushParams, LivePushResult> = defineMethod({
  method: "live/push",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
