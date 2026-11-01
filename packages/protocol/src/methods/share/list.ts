import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";
import { Share } from "./start.ts";

/** The params of `share/list` (D158). */
export interface ShareListParams {
  /** Only this artifact's shares. */
  readonly artifact?: ArtifactRef;
  /** Shares that ended too, newest first; default: active shares only. */
  readonly all?: boolean;
}

/** The result of `share/list`. */
export interface ShareListResult {
  /** Active shares first, each kind newest first. */
  readonly shares: readonly Share[];
}

const params: z.ZodType<ShareListParams> = z
  .object({ artifact: ArtifactRef.exactOptional(), all: z.boolean().exactOptional() })
  .register(wireRegistry, { id: "ShareListParams" });

const result: z.ZodType<ShareListResult> = z
  .object({ shares: z.array(Share).readonly() })
  .register(wireRegistry, {
    id: "ShareListResult",
    description: "Shares with their links and state.",
  });

/**
 * `share/list`: the home's shares (D158), each with its tunnel, link, state and, once it ended,
 * why: a tunnel that dropped and couldn't come back shows here.
 */
export const shareListMethod: MethodDefinition<ShareListParams, ShareListResult> = defineMethod({
  method: "share/list",
  direction: "client-to-instance",
  mutating: false,
  params,
  result,
});
