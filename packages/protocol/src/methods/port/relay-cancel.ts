import * as z from "zod";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `port/relay.cancel` (INTERFACES §18.3). */
export interface PortRelayCancelParams {
  /** The hosted run to cancel. */
  readonly runId: string;
}

/** The result of `port/relay.cancel`. */
export type PortRelayCancelResult = Record<string, never>;

const params: z.ZodType<PortRelayCancelParams> = z
  .object({ runId: z.string().min(1) })
  .register(wireRegistry, { id: "PortRelayCancelParams" });

const result: z.ZodType<PortRelayCancelResult> = z
  .object({})
  .register(wireRegistry, { id: "PortRelayCancelResult" });

/**
 * `port/relay.cancel`: a viewer cancelled a relayed run; the owner fires its `abortSignal` if it
 * still runs (AC-04). A cancel made while the owner was away arrives on reconnect.
 */
export const portRelayCancelMethod: MethodDefinition<PortRelayCancelParams, PortRelayCancelResult> =
  defineMethod({
    method: "port/relay.cancel",
    direction: "instance-to-host",
    mutating: false,
    params,
    result,
  });
