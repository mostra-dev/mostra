import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";
import { SecretEntry } from "./set.ts";

/** The params of `secret/list` (INTERFACES §6). */
export interface SecretListParams {
  /** Also list this artifact's own secrets; the home's shared ones are always listed. */
  readonly artifact?: ArtifactRef;
}

/** The result of `secret/list`: names and scopes, never values. */
export interface SecretListResult {
  /** The secrets, home ones first. */
  readonly secrets: readonly SecretEntry[];
}

const params: z.ZodType<SecretListParams> = z
  .object({ artifact: ArtifactRef.exactOptional() })
  .register(wireRegistry, {
    id: "SecretListParams",
    description: "The artifact whose secrets to list.",
  });

const result: z.ZodType<SecretListResult> = z
  .object({ secrets: z.array(SecretEntry).readonly() })
  .register(wireRegistry, { id: "SecretListResult", description: "Secrets by name and scope." });

/**
 * `secret/list`: the names of the home's shared secrets, and of an artifact's own when one is
 * named, with their scopes; a value is never returned (D44).
 */
export const secretListMethod: MethodDefinition<SecretListParams, SecretListResult> = defineMethod({
  method: "secret/list",
  direction: "client-to-instance",
  mutating: false,
  params,
  result,
});
