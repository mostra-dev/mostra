import * as z from "zod";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `port/secrets.get` (INTERFACES §7, D44). */
export interface PortSecretsGetParams {
  /** The artifact whose server code asks. */
  readonly artifactId: string;
  /** The secret's name. */
  readonly name: string;
}

/** The result of `port/secrets.get`: the value, or `null` when the host has none. */
export type PortSecretsGetResult = string | null;

const params: z.ZodType<PortSecretsGetParams> = z
  .object({ artifactId: z.string(), name: z.string() })
  .register(wireRegistry, {
    id: "PortSecretsGetParams",
    description: "The artifact and the name of the secret its server code asks for.",
  });

const result: z.ZodType<PortSecretsGetResult> = z.string().nullable().register(wireRegistry, {
  id: "PortSecretsGetResult",
  description: "The secret's value, or null when the host has none.",
});

/**
 * `port/secrets.get`: Mostra asks the host that registered the `secrets` port for a secret its
 * artifact's server code reads (D44), with 30 seconds to answer. `null` falls back to the home's
 * own store; a failure or a timeout fails the read with `MOSTRA_SECRET_MISSING`.
 */
export const portSecretsGetMethod: MethodDefinition<PortSecretsGetParams, PortSecretsGetResult> =
  defineMethod({
    method: "port/secrets.get",
    direction: "instance-to-host",
    mutating: false,
    params,
    result,
  });
