import * as z from "zod";
import { Cursor } from "../../ids.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `relay/effect` (INTERFACES §18.3). */
export interface RelayEffectParams {
  /** The artifact, by its own ID. */
  readonly artifactId: string;
  /** The relayed run whose server code raised it. */
  readonly runId?: string;
  /** Or the relayed plain call. */
  readonly callId?: string;
  /** `signal()` or `emit()` (§2.4). */
  readonly kind: "signal" | "emit";
  /** The signal's name, or the host event's type (`host.…`). */
  readonly name: string;
  /** Its JSON payload, at most 64 KiB. */
  readonly payload?: unknown;
}

/** The result of `relay/effect`: the event's cursor in the hosted home. */
export interface RelayEffectResult {
  /** Where the hosted home appended it. */
  readonly cursor: Cursor;
}

const params: z.ZodType<RelayEffectParams> = z
  .object({
    artifactId: z.string().min(1),
    runId: z.string().exactOptional(),
    callId: z.string().exactOptional(),
    kind: z.enum(["signal", "emit"]),
    name: z.string().min(1).max(200),
    payload: z.unknown().exactOptional(),
  })
  .register(wireRegistry, { id: "RelayEffectParams" });

const result: z.ZodType<RelayEffectResult> = z
  .object({ cursor: Cursor.schema })
  .register(wireRegistry, { id: "RelayEffectResult" });

/**
 * `relay/effect`: a relayed run's or call's server code raised a signal or emitted a host event;
 * the hosted home appends it with the run's causation and the viewer who pressed it (D165 item 4),
 * where the page and the owner's follow see it.
 */
export const relayEffectMethod: MethodDefinition<RelayEffectParams, RelayEffectResult> =
  defineMethod({
    method: "relay/effect",
    direction: "client-to-instance",
    mutating: true,
    params,
    result,
  });
