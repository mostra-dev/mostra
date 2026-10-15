import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { Cursor } from "../../ids.ts";
import { EventRecord, WaitCondition } from "../../interaction.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The longest `wait`, in milliseconds: the longest timer JavaScript keeps (about 24.8 days). */
export const WAIT_MAX_MS = 2_147_483_647;

/** The params of `wait` (INTERFACES §6, ARCHITECTURE §6, D103). */
export interface WaitParams {
  /** The artifact to wait on. */
  readonly artifact: ArtifactRef;
  /** `submitted`, `signal:<name>`, `state:<fieldId>` or `event:<type>`. */
  readonly until: WaitCondition;
  /**
   * Wait for what happens after this cursor (edge-triggered conditions, and `submitted` under
   * `epochs`). Default: the cursor of the artifact's latest publish.
   */
  readonly after?: string;
  /** How long to block, in milliseconds; 0 checks once. */
  readonly timeoutMs: number;
}

/** The result of `wait`. */
export type WaitResult =
  | { readonly status: "satisfied"; readonly event: EventRecord; readonly cursor: string }
  | { readonly status: "still_waiting"; readonly cursor: string };

const params: z.ZodType<WaitParams> = z
  .object({
    artifact: ArtifactRef,
    until: WaitCondition,
    after: Cursor.schema.exactOptional(),
    timeoutMs: z.int().min(0).max(WAIT_MAX_MS),
  })
  .register(wireRegistry, { id: "WaitParams" });

const result: z.ZodType<WaitResult> = z
  .discriminatedUnion("status", [
    z.object({ status: z.literal("satisfied"), event: EventRecord, cursor: Cursor.schema }),
    z.object({ status: z.literal("still_waiting"), cursor: Cursor.schema }),
  ])
  .register(wireRegistry, { id: "WaitResult" });

/**
 * `wait`: blocks until a condition holds or the timeout passes (IN-10). `satisfied` carries the
 * event that met it; `still_waiting` carries the newest cursor examined, so a later wait from it
 * misses nothing.
 */
export const waitMethod: MethodDefinition<WaitParams, WaitResult> = defineMethod({
  method: "wait",
  direction: "client-to-instance",
  mutating: false,
  params,
  result,
});
