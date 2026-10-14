import * as z from "zod";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";
import { InstanceInfo } from "../mostra/initialize.ts";

/** The params of `instance/status` (INTERFACES §6): none. */
export type InstanceStatusParams = Record<string, never>;

/** One child process the instance supervises. */
export interface ChildProcessStatus {
  /** The process ID. The child leads its own process group, so this is also its group ID. */
  readonly pid: number;
  /** What the child is: `builder`, `verify`, `worker`, `pty-host`, `demo`, `install` and so on. */
  readonly kind: string;
  /** What the child serves, such as an artifact or version ID. */
  readonly ownerRef: string;
  /** When the instance started it (RFC 3339, UTC). */
  readonly startedAt: string;
}

/** Where the gateway listens (D99, WP-05). */
export interface GatewayStatus {
  /** The address its listeners bind: `127.0.0.1` unless the instance started with `--bind`. */
  readonly bind: string;
  /** The shell's origin, where every capability link points. */
  readonly shell: string;
  /** The artifact origins it is serving now, one per opened artifact. */
  readonly artifacts: readonly { readonly artifactId: string; readonly origin: string }[];
}

/**
 * The result of `instance/status`. The packages that add ports, deliveries, shares and versions
 * add their fields here (INTERFACES §6).
 */
export interface InstanceStatusResult {
  /** The instance itself. */
  readonly instance: InstanceInfo;
  /** When the instance took ownership of its home (RFC 3339, UTC). */
  readonly startedAt: string;
  /** The control socket clients attach to. */
  readonly socket: string;
  /** How many protocol connections are open, this one included. */
  readonly connections: number;
  /** The child processes the instance supervises. */
  readonly processes: readonly ChildProcessStatus[];
  /** Where the gateway listens, once it has started (WP-05). */
  readonly gateway?: GatewayStatus;
}

/** The Zod schema of the `GatewayStatus` type. */
export const GatewayStatus: z.ZodType<GatewayStatus> = z
  .object({
    bind: z.string(),
    shell: z.string(),
    artifacts: z.array(z.object({ artifactId: z.string(), origin: z.string() })).readonly(),
  })
  .register(wireRegistry, { id: "GatewayStatus", description: "Where the gateway listens." });

/** The Zod schema of the `ChildProcessStatus` type. */
export const ChildProcessStatus: z.ZodType<ChildProcessStatus> = z
  .object({
    pid: z.int().min(1),
    kind: z.string(),
    ownerRef: z.string(),
    startedAt: z.iso.datetime(),
  })
  .register(wireRegistry, {
    id: "ChildProcessStatus",
    description: "One child process the instance supervises.",
  });

const params: z.ZodType<InstanceStatusParams> = z
  .object({})
  .register(wireRegistry, { id: "InstanceStatusParams" });

const result: z.ZodType<InstanceStatusResult> = z
  .object({
    instance: InstanceInfo,
    startedAt: z.iso.datetime(),
    socket: z.string(),
    connections: z.int().min(0),
    processes: z.array(ChildProcessStatus).readonly(),
    gateway: GatewayStatus.exactOptional(),
  })
  .register(wireRegistry, { id: "InstanceStatusResult" });

/** `instance/status`: reports the instance, its socket, its connections and its child processes. */
export const instanceStatusMethod: MethodDefinition<InstanceStatusParams, InstanceStatusResult> =
  defineMethod({
    method: "instance/status",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
