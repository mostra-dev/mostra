import * as z from "zod";
import { ArtifactSummary } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** Narrows `artifact/list`. */
export interface ArtifactListFilter {
  /** Only artifacts of this family (INTERFACES §2.2). */
  readonly family?: string;
}

/** The params of `artifact/list` (INTERFACES §6). */
export interface ArtifactListParams {
  /** Narrows the list; all artifacts when absent. */
  readonly filter?: ArtifactListFilter;
}

/** The result of `artifact/list`. */
export interface ArtifactListResult {
  /** The home's published artifacts, most recently published first. */
  readonly artifacts: readonly ArtifactSummary[];
}

const params: z.ZodType<ArtifactListParams> = z
  .object({
    filter: z.object({ family: z.string().min(1).exactOptional() }).exactOptional(),
  })
  .register(wireRegistry, { id: "ArtifactListParams" });

const result: z.ZodType<ArtifactListResult> = z
  .object({ artifacts: z.array(ArtifactSummary).readonly() })
  .register(wireRegistry, { id: "ArtifactListResult" });

/** `artifact/list`: lists the home's published artifacts. */
export const artifactListMethod: MethodDefinition<ArtifactListParams, ArtifactListResult> =
  defineMethod({
    method: "artifact/list",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
