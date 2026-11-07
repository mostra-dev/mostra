import * as z from "zod";
import { Batches } from "../../actions.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `relay/call.batch` (INTERFACES §18.3). */
export interface RelayCallBatchParams {
  /** The hosted home's call. */
  readonly callId: string;
  /** Grows by one per message of the call. */
  readonly seq: number;
  /** Serialized batches of the result, in order. */
  readonly batches?: Batches;
  /** The call's end: the last message. */
  readonly end?: {
    readonly status: "succeeded" | "failed";
    readonly error?: { readonly message: string; readonly code?: string };
  };
}

/** The result of `relay/call.batch`. */
export type RelayCallBatchResult = Record<string, never>;

const params: z.ZodType<RelayCallBatchParams> = z
  .object({
    callId: z.string().min(1),
    seq: z.int().min(1),
    batches: Batches.exactOptional(),
    end: z
      .object({
        status: z.enum(["succeeded", "failed"]),
        error: z
          .object({ message: z.string().max(10_000), code: z.string().max(200).exactOptional() })
          .exactOptional(),
      })
      .exactOptional(),
  })
  .register(wireRegistry, { id: "RelayCallBatchParams" });

const result: z.ZodType<RelayCallBatchResult> = z
  .object({})
  .register(wireRegistry, { id: "RelayCallBatchResult" });

/** `relay/call.batch`: the owner streams a relayed plain call's result back, then its end. */
export const relayCallBatchMethod: MethodDefinition<RelayCallBatchParams, RelayCallBatchResult> =
  defineMethod({
    method: "relay/call.batch",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
