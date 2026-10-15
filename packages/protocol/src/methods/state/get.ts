import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { DocumentRevision, FieldState } from "../../interaction.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `state/get` (INTERFACES §6, D63). */
export interface StateGetParams {
  /** The artifact whose shared state to read. */
  readonly artifact: ArtifactRef;
  /** Only these field IDs; absent: every field. */
  readonly ids?: readonly string[];
}

/** The result of `state/get`: the artifact state's revision and its fields by ID. */
export interface StateGetResult {
  /** The state's revision; pass it as `baseRevision` to `state/patch` for compare-and-set. */
  readonly revision: DocumentRevision;
  /** The fields by ID. */
  readonly fields: Readonly<Record<string, FieldState>>;
}

const params: z.ZodType<StateGetParams> = z
  .object({
    artifact: ArtifactRef,
    ids: z.array(z.string().min(1).max(256)).max(10_000).readonly().exactOptional(),
  })
  .register(wireRegistry, { id: "StateGetParams" });

const result: z.ZodType<StateGetResult> = z
  .object({ revision: DocumentRevision, fields: z.record(z.string(), FieldState) })
  .register(wireRegistry, { id: "StateGetResult" });

/**
 * `state/get`: reads an artifact's shared state (its artifact-scoped fields, D63) with each
 * field's value, revision and last writer.
 */
export const stateGetMethod: MethodDefinition<StateGetParams, StateGetResult> = defineMethod({
  method: "state/get",
  direction: "client-to-instance",
  mutating: false,
  params,
  result,
});
