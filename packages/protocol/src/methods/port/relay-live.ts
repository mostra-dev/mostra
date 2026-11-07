import * as z from "zod";
import { LIVE_KEY_PATTERN } from "../../actions.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `port/relay.live` (INTERFACES §18.3). */
export interface PortRelayLiveParams {
  /** The artifact, by its own ID. */
  readonly artifactId: string;
  /** The version whose producers are wanted: the artifact's latest on the hosted home. */
  readonly versionId: string;
  /**
   * `start` and `renew` keep the producers of `keys` running for a minute; `stop` lets them stop;
   * `refresh` asks them to load again now.
   */
  readonly interest: "start" | "renew" | "stop" | "refresh";
  /** The live sources' keys. */
  readonly keys: readonly string[];
}

/** The result of `port/relay.live`. */
export type PortRelayLiveResult = Record<string, never>;

const params: z.ZodType<PortRelayLiveParams> = z
  .object({
    artifactId: z.string().min(1),
    versionId: z.string().min(1),
    interest: z.enum(["start", "renew", "stop", "refresh"]),
    keys: z.array(z.string().regex(LIVE_KEY_PATTERN)).max(1000).readonly(),
  })
  .register(wireRegistry, { id: "PortRelayLiveParams" });

const result: z.ZodType<PortRelayLiveResult> = z
  .object({})
  .register(wireRegistry, { id: "PortRelayLiveResult" });

/**
 * `port/relay.live`: viewers of a hosted page want (or no longer want) its live sources, so their
 * producers run on the owner instance while someone views (D165 item 4).
 */
export const portRelayLiveMethod: MethodDefinition<PortRelayLiveParams, PortRelayLiveResult> =
  defineMethod({
    method: "port/relay.live",
    direction: "instance-to-host",
    mutating: false,
    params,
    result,
  });
