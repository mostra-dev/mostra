import * as z from "zod";
import { SECRET_NAME_PATTERN } from "../../actions.ts";
import { ArtifactRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `secret/delete` (INTERFACES §6). */
export interface SecretDeleteParams {
  /** The secret's name. */
  readonly name: string;
  /** The artifact whose own secret to delete; absent: the home's shared one. */
  readonly artifact?: ArtifactRef;
}

/** The result of `secret/delete`. */
export interface SecretDeleteResult {
  /** Whether a secret was there to delete. */
  readonly deleted: boolean;
}

const params: z.ZodType<SecretDeleteParams> = z
  .object({ name: z.string().regex(SECRET_NAME_PATTERN), artifact: ArtifactRef.exactOptional() })
  .register(wireRegistry, { id: "SecretDeleteParams", description: "The secret to delete." });

const result: z.ZodType<SecretDeleteResult> = z
  .object({ deleted: z.boolean() })
  .register(wireRegistry, {
    id: "SecretDeleteResult",
    description: "Whether a secret was deleted.",
  });

/**
 * `secret/delete`: removes a secret from the home's store. Deleting one that isn't there succeeds
 * with `deleted: false`, so the method is idempotent and takes no `requestId`.
 */
export const secretDeleteMethod: MethodDefinition<SecretDeleteParams, SecretDeleteResult> =
  defineMethod({
    method: "secret/delete",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
