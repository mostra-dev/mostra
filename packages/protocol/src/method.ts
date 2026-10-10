/**
 * Host protocol methods (INTERFACES §6, D59): JSON-RPC 2.0 methods between clients and an
 * instance, each defined once with Zod schemas for its params and result. `pnpm gen
 * protocol-method <group>/<name>` adds one in the right shape; the method modules live in
 * `methods/` and are listed in `methods/index.ts`.
 */
import type * as z from "zod";

/** Who sends the request: a client to the instance, or the instance to a registering host (ports). */
export type MethodDirection = "client-to-instance" | "instance-to-host";

/** One protocol method. */
export interface MethodDefinition<Params, Result> {
  /** The JSON-RPC method name: `group/name` (`artifact/publish`) or a bare name (`wait`). */
  readonly method: string;
  /** Who sends the request. */
  readonly direction: MethodDirection;
  /**
   * Whether the method changes durable state. Mutating methods take an optional `requestId`, and a
   * retry with the same ID returns the recorded result (H-03).
   */
  readonly mutating: boolean;
  /** The schema of the request's `params`. */
  readonly params: z.ZodType<Params>;
  /** The schema of a successful response's `result`. */
  readonly result: z.ZodType<Result>;
}

/** A method of any params and result type. */
export type AnyMethod = MethodDefinition<unknown, unknown>;

/** Defines a protocol method, checking its name has the `group/name` (or bare `name`) form. */
export function defineMethod<Params, Result>(
  definition: MethodDefinition<Params, Result>,
): MethodDefinition<Params, Result> {
  if (!/^([a-z][a-zA-Z]*\/)?[a-z][a-zA-Z.]*$/.test(definition.method)) {
    throw new Error(
      `Protocol method names have the form group/name or name, got "${definition.method}".`,
    );
  }
  return definition;
}
