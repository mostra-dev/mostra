import * as z from "zod";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `dev/stop` (INTERFACES §6, D140 item 12). */
export interface DevStopParams {
  /** The session `dev/start` returned. */
  readonly sessionId: string;
}

/** The result of `dev/stop`. */
export type DevStopResult = Record<string, never>;

const params: z.ZodType<DevStopParams> = z
  .object({ sessionId: z.string().min(1) })
  .register(wireRegistry, { id: "DevStopParams" });

const result: z.ZodType<DevStopResult> = z
  .object({})
  .register(wireRegistry, { id: "DevStopResult" });

/**
 * `dev/stop`: ends a dev session this connection started, stopping its Vite child and workers
 * and deleting its scratch state. Stopping a session that already ended succeeds.
 */
export const devStopMethod: MethodDefinition<DevStopParams, DevStopResult> = defineMethod({
  method: "dev/stop",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
