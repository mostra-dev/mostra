import * as z from "zod";
import { Batches } from "../../actions.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** Who pressed a relayed action, as its server code's `viewer()` reads it. */
export interface RelayViewer {
  /** The hosted home's viewer ID. */
  readonly id: string;
  /** The display name, when one is known. */
  readonly name?: string;
}

/** The Zod schema of the `RelayViewer` type. */
export const RelayViewer: z.ZodType<RelayViewer> = z
  .object({ id: z.string().min(1), name: z.string().exactOptional() })
  .register(wireRegistry, {
    id: "RelayViewer",
    description: "The viewer a relayed run or call acts for: the hosted home's viewer ID and name.",
  });

/** The params of `port/relay.run` (INTERFACES §18.3). */
export interface PortRelayRunParams {
  /** The hosted home's run ID: the owner records the run under it, so a repeat joins it. */
  readonly runId: string;
  /** The run's relay sequence, unique per owner link and growing (the owner's `relayMark`). */
  readonly seq: number;
  /** The artifact, by its own ID. */
  readonly artifactId: string;
  /** The version whose server code runs it: the view's. */
  readonly versionId: string;
  /** The server function: `<module path>#<export>`. */
  readonly fnId: string;
  /** Its serialized arguments. */
  readonly args: Batches;
  /** The run's idempotency key, which the hosted home checked (D130). */
  readonly key?: string;
  /** Who pressed it. */
  readonly viewer?: RelayViewer;
  /** The hosted view that started it. */
  readonly viewId?: string;
}

/** The result of `port/relay.run`: the owner recorded the run, so it happens at most once. */
export interface PortRelayRunResult {
  /** Always `true`: a run the owner can't record is an error. */
  readonly accepted: true;
}

const params: z.ZodType<PortRelayRunParams> = z
  .object({
    runId: z.string().min(1),
    seq: z.int().min(1),
    artifactId: z.string().min(1),
    versionId: z.string().min(1),
    fnId: z.string().min(1),
    args: Batches,
    key: z.string().exactOptional(),
    viewer: RelayViewer.exactOptional(),
    viewId: z.string().exactOptional(),
  })
  .register(wireRegistry, { id: "PortRelayRunParams" });

const result: z.ZodType<PortRelayRunResult> = z
  .object({ accepted: z.literal(true) })
  .register(wireRegistry, { id: "PortRelayRunResult" });

/**
 * `port/relay.run`: a hosted home hands its owner instance a run to execute (D165 item 4), answered
 * once the owner recorded it under the hosted run's ID; its progress, log, result and end come back
 * as `relay/run.update`.
 */
export const portRelayRunMethod: MethodDefinition<PortRelayRunParams, PortRelayRunResult> =
  defineMethod({
    method: "port/relay.run",
    direction: "instance-to-host",
    mutating: false,
    params,
    result,
  });
