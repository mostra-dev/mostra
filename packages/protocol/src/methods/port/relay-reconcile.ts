import * as z from "zod";
import { RunState } from "../../actions.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** What the hosted home holds of a run already, so the owner answers only what is newer. */
export interface RelayHeld {
  /** The run. */
  readonly runId: string;
  /** How many log lines it holds. */
  readonly log: number;
  /** How many result batches it holds. */
  readonly batches: number;
}

/** The params of `port/relay.reconcile` (INTERFACES §18.3). */
export interface PortRelayReconcileParams {
  /** The runs the owner accepted and the hosted home holds no end for. */
  readonly runs: readonly string[];
  /** What the hosted home holds of each (additive: the owner answers from there). */
  readonly held?: readonly RelayHeld[];
}

/** One run as the owner knows it, or `unknown-to-owner` when its ledger has no such run. */
export interface RelayReconciled {
  /** The run. */
  readonly runId: string;
  /** Its state from the held positions on, or `unknown-to-owner`. */
  readonly state: RunState | "unknown-to-owner";
}

/** The result of `port/relay.reconcile`. */
export interface PortRelayReconcileResult {
  /** One answer per run asked about. */
  readonly runs: readonly RelayReconciled[];
}

const held: z.ZodType<RelayHeld> = z
  .object({ runId: z.string().min(1), log: z.int().min(0), batches: z.int().min(0) })
  .register(wireRegistry, { id: "RelayHeld" });

const params: z.ZodType<PortRelayReconcileParams> = z
  .object({
    runs: z.array(z.string().min(1)).max(10_000).readonly(),
    held: z.array(held).max(10_000).readonly().exactOptional(),
  })
  .register(wireRegistry, { id: "PortRelayReconcileParams" });

const reconciled: z.ZodType<RelayReconciled> = z
  .object({ runId: z.string(), state: z.union([RunState, z.literal("unknown-to-owner")]) })
  .register(wireRegistry, { id: "RelayReconciled" });

const result: z.ZodType<PortRelayReconcileResult> = z
  .object({ runs: z.array(reconciled).readonly() })
  .register(wireRegistry, { id: "PortRelayReconcileResult" });

/**
 * `port/relay.reconcile`: after every reconnect, before any waiting run drains, the hosted home
 * asks its owner for the runs it accepted and hasn't finished (D165 item 4); a run the owner
 * doesn't know becomes `unknown` and is never sent again.
 */
export const portRelayReconcileMethod: MethodDefinition<
  PortRelayReconcileParams,
  PortRelayReconcileResult
> = defineMethod({
  method: "port/relay.reconcile",
  direction: "instance-to-host",
  mutating: false,
  params,
  result,
});
