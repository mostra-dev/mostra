import * as z from "zod";
import { Batches, RunProgress } from "../../actions.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** How a relayed run ended, as the owner ran it. */
export interface RelayRunEnd {
  /** The run's final state. */
  readonly status: "succeeded" | "failed" | "cancelled";
  /** Why, as a local run's `reason`. */
  readonly reason?: string;
  /** What went wrong, without the stack. */
  readonly error?: { readonly message: string; readonly code?: string };
}

/** The params of `relay/run.update` (INTERFACES §18.3). */
export interface RelayRunUpdateParams {
  /** The hosted run. */
  readonly runId: string;
  /** Grows by one per update of the run; a repeat is ignored. */
  readonly seq: number;
  /** Its worker has it now. */
  readonly running?: boolean;
  /** Its latest progress. */
  readonly progress?: RunProgress;
  /** New log lines, from `logFrom`. */
  readonly log?: readonly string[];
  /** The index of `log`'s first line (additive: positions make a repeat harmless). */
  readonly logFrom?: number;
  /** New result batches, from `batchFrom`. */
  readonly batches?: Batches;
  /** The index of `batches`' first batch. */
  readonly batchFrom?: number;
  /** The run's end: the last update. */
  readonly end?: RelayRunEnd;
}

/** The result of `relay/run.update`. */
export type RelayRunUpdateResult = Record<string, never>;

const end: z.ZodType<RelayRunEnd> = z
  .object({
    status: z.enum(["succeeded", "failed", "cancelled"]),
    reason: z.string().max(200).exactOptional(),
    error: z
      .object({ message: z.string().max(10_000), code: z.string().max(200).exactOptional() })
      .exactOptional(),
  })
  .register(wireRegistry, { id: "RelayRunEnd" });

const params: z.ZodType<RelayRunUpdateParams> = z
  .object({
    runId: z.string().min(1),
    seq: z.int().min(1),
    running: z.boolean().exactOptional(),
    progress: RunProgress.exactOptional(),
    log: z.array(z.string()).readonly().exactOptional(),
    logFrom: z.int().min(0).exactOptional(),
    batches: Batches.exactOptional(),
    batchFrom: z.int().min(0).exactOptional(),
    end: end.exactOptional(),
  })
  .register(wireRegistry, { id: "RelayRunUpdateParams" });

const result: z.ZodType<RelayRunUpdateResult> = z
  .object({})
  .register(wireRegistry, { id: "RelayRunUpdateResult" });

/**
 * `relay/run.update`: the owner instance reports a relayed run's progress, log, result and end to
 * its hosted home, in order and idempotently; an update for a run the hosted home doesn't know is
 * dropped and logged (D165 item 4).
 */
export const relayRunUpdateMethod: MethodDefinition<RelayRunUpdateParams, RelayRunUpdateResult> =
  defineMethod({
    method: "relay/run.update",
    direction: "client-to-instance",
    mutating: true,
    params,
    result,
  });
