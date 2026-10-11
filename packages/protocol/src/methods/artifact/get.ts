import * as z from "zod";
import { ArtifactDetail, ArtifactRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `artifact/get` (INTERFACES §6). */
export interface ArtifactGetParams {
  /** The artifact, by ID or by a source path bound to it. */
  readonly artifact: ArtifactRef;
}

/** The result of `artifact/get`. */
export type ArtifactGetResult = ArtifactDetail;

const params: z.ZodType<ArtifactGetParams> = z
  .object({ artifact: ArtifactRef })
  .register(wireRegistry, { id: "ArtifactGetParams" });

/**
 * `artifact/get`: one artifact with its metadata, policy, source and every version. An unknown
 * artifact is `MOSTRA_ARTIFACT_NOT_FOUND`.
 */
export const artifactGetMethod: MethodDefinition<ArtifactGetParams, ArtifactGetResult> =
  defineMethod({
    method: "artifact/get",
    direction: "client-to-instance",
    mutating: false,
    params,
    result: ArtifactDetail,
  });
