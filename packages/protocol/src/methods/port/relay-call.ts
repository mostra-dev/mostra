import * as z from "zod";
import { Batches } from "../../actions.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";
import { RelayViewer } from "./relay-run.ts";

/** The params of `port/relay.call` (INTERFACES §18.3). */
export interface PortRelayCallParams {
  /** The hosted home's ID for this call: its batches come back as `relay/call.batch`. */
  readonly callId: string;
  /** The artifact, by its own ID. */
  readonly artifactId: string;
  /** The version whose server code answers it: the view's. */
  readonly versionId: string;
  /** The server function. */
  readonly fnId: string;
  /** Its serialized arguments. */
  readonly args: Batches;
  /** Who called it. */
  readonly viewer?: RelayViewer;
  /** The hosted view that called it. */
  readonly viewId?: string;
}

/** The result of `port/relay.call`. */
export interface PortRelayCallResult {
  /** Always `true`: the owner's worker has the call. */
  readonly accepted: true;
}

const params: z.ZodType<PortRelayCallParams> = z
  .object({
    callId: z.string().min(1),
    artifactId: z.string().min(1),
    versionId: z.string().min(1),
    fnId: z.string().min(1),
    args: Batches,
    viewer: RelayViewer.exactOptional(),
    viewId: z.string().exactOptional(),
  })
  .register(wireRegistry, { id: "PortRelayCallParams" });

const result: z.ZodType<PortRelayCallResult> = z
  .object({ accepted: z.literal(true) })
  .register(wireRegistry, { id: "PortRelayCallResult" });

/**
 * `port/relay.call`: a plain call relayed to the owner while it is connected (D165 item 4); it
 * leaves no record, and its batches and end come back as `relay/call.batch`.
 */
export const portRelayCallMethod: MethodDefinition<PortRelayCallParams, PortRelayCallResult> =
  defineMethod({
    method: "port/relay.call",
    direction: "instance-to-host",
    mutating: false,
    params,
    result,
  });
