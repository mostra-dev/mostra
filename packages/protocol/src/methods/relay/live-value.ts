import * as z from "zod";
import { Batches, LIVE_KEY_PATTERN } from "../../actions.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `relay/live.value` (INTERFACES §18.3). */
export interface RelayLiveValueParams {
  /** The artifact, by its own ID. */
  readonly artifactId: string;
  /** The version whose producer made it. */
  readonly versionId: string;
  /** The live source's key. */
  readonly key: string;
  /** The value, serialized. */
  readonly value?: Batches;
  /** What went wrong instead. */
  readonly error?: { readonly message: string; readonly code?: string };
  /** When the owner's producer made it. */
  readonly at: string;
}

/** The result of `relay/live.value`. */
export interface RelayLiveValueResult {
  /** The value's revision on the hosted home; absent for an error. */
  readonly revision?: string;
}

const params: z.ZodType<RelayLiveValueParams> = z
  .object({
    artifactId: z.string().min(1),
    versionId: z.string().min(1),
    key: z.string().regex(LIVE_KEY_PATTERN),
    value: Batches.exactOptional(),
    error: z.object({ message: z.string(), code: z.string().exactOptional() }).exactOptional(),
    at: z.string(),
  })
  .register(wireRegistry, { id: "RelayLiveValueParams" });

const result: z.ZodType<RelayLiveValueResult> = z
  .object({ revision: z.string().exactOptional() })
  .register(wireRegistry, { id: "RelayLiveValueResult" });

/**
 * `relay/live.value`: a value (or failure) of a hosted artifact's live source, which a producer on
 * the owner instance made; the hosted home keeps it and its ring and serves it to viewers.
 */
export const relayLiveValueMethod: MethodDefinition<RelayLiveValueParams, RelayLiveValueResult> =
  defineMethod({
    method: "relay/live.value",
    direction: "client-to-instance",
    mutating: true,
    params,
    result,
  });
