import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** Who paused an artifact (D165 item 14). */
export type PausedBy = "owner" | "operator";

/** The params of `artifact/pause` (INTERFACES §18.2, D165 item 14). */
export interface ArtifactPauseParams {
  /** The artifact to pause or resume. */
  readonly artifact: ArtifactRef;
  /** `true` pauses it, `false` resumes it. */
  readonly paused: boolean;
  /** Why, shown to viewers as text while it is paused. */
  readonly reason?: string;
  /** Makes retries idempotent: a repeated `requestId` returns the recorded result (H-03). */
  readonly requestId?: string;
}

/** The result of `artifact/pause`: whether the artifact is paused now, and by whom. */
export interface ArtifactPauseResult {
  /** Whether it is paused after the call. */
  readonly paused: boolean;
  /** Who paused it, while it is paused. */
  readonly by?: PausedBy;
}

const params: z.ZodType<ArtifactPauseParams> = z
  .object({
    artifact: ArtifactRef,
    paused: z.boolean(),
    reason: z.string().max(500).exactOptional(),
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "ArtifactPauseParams" });

const result: z.ZodType<ArtifactPauseResult> = z
  .object({
    paused: z.boolean(),
    by: z.enum(["owner", "operator"]).exactOptional(),
  })
  .register(wireRegistry, { id: "ArtifactPauseResult" });

/**
 * `artifact/pause`: pauses or resumes an artifact. While paused it stays viewable and its shell
 * says so; submissions answer 423 `MOSTRA_SUBMIT_PAUSED` and actions 423 `MOSTRA_ACTION_PAUSED`,
 * each keeping the draft; links stay valid. On an owner instance it acts on the local artifact and,
 * for a hosted one, on every server it is hosted on. An operator's pause can't be resumed by the
 * owner (`MOSTRA_REMOTE_PAUSED_BY_OPERATOR`).
 */
export const artifactPauseMethod: MethodDefinition<ArtifactPauseParams, ArtifactPauseResult> =
  defineMethod({
    method: "artifact/pause",
    direction: "client-to-instance",
    mutating: true,
    params,
    result,
  });
