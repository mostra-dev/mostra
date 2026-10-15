import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { MutationId } from "../../ids.ts";
import { DocumentRevision, FieldOp, MutationResult } from "../../interaction.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `state/patch` (INTERFACES §6, D63, D106). */
export interface StatePatchParams {
  /** The artifact whose shared state to write. */
  readonly artifact: ArtifactRef;
  /** The field changes, applied together under one revision. */
  readonly ops: readonly FieldOp[];
  /**
   * The state revision the caller last read. A field changed after it is a conflict and keeps its
   * value; the other ops apply. Absent: every op applies, whatever changed in between.
   */
  readonly baseRevision?: DocumentRevision;
  /**
   * The change's ID, the idempotency key of this method (H-03): a retry with the same ID and
   * contents returns the recorded result.
   */
  readonly mutationId: string;
  /** Who writes: `agent` (the default) or `host`, recorded as each field's last writer. */
  readonly as?: "agent" | "host";
}

/** The result of `state/patch`. */
export type StatePatchResult = MutationResult;

const params: z.ZodType<StatePatchParams> = z
  .object({
    artifact: ArtifactRef,
    ops: z.array(FieldOp).min(1).max(1000).readonly(),
    baseRevision: DocumentRevision.exactOptional(),
    mutationId: MutationId.schema,
    as: z.enum(["agent", "host"]).exactOptional(),
  })
  .register(wireRegistry, { id: "StatePatchParams" });

/**
 * `state/patch`: writes an artifact's shared state with compare-and-set and per-field conflicts,
 * through the same path as viewers' edits (D63). Changes append `state.changed`.
 */
export const statePatchMethod: MethodDefinition<StatePatchParams, StatePatchResult> = defineMethod({
  method: "state/patch",
  direction: "client-to-instance",
  mutating: true,
  params,
  result: MutationResult,
});
