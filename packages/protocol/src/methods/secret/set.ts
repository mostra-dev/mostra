import * as z from "zod";
import { SECRET_NAME_PATTERN, SECRET_VALUE_MAX } from "../../actions.ts";
import { ArtifactRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `secret/set` (INTERFACES §6, D44). */
export interface SecretSetParams {
  /** Letters, digits, `_`, `.` and `-`, starting with a letter or `_`, at most 128 characters. */
  readonly name: string;
  /** The value, at most 64 KiB of UTF-8. Never returned by any method. */
  readonly value: string;
  /** The artifact the secret belongs to; absent: shared by every artifact of the home. */
  readonly artifact?: ArtifactRef;
}

/** Where a secret lives. */
export interface SecretEntry {
  /** The secret's name. */
  readonly name: string;
  /** `artifact` for one artifact's secret, `home` for one every artifact shares. */
  readonly scope: "artifact" | "home";
  /** The artifact, for `scope: "artifact"`. */
  readonly artifactId?: string;
  /** When it was last set. */
  readonly updatedAt: string;
}

/** The Zod schema of the `SecretEntry` type. */
export const SecretEntry: z.ZodType<SecretEntry> = z
  .object({
    name: z.string(),
    scope: z.enum(["artifact", "home"]),
    artifactId: z.string().exactOptional(),
    updatedAt: z.string(),
  })
  .register(wireRegistry, {
    id: "SecretEntry",
    description: "A secret's name, scope and when it was set; never its value.",
  });

/** The result of `secret/set`: the secret, without its value. */
export type SecretSetResult = SecretEntry;

const params: z.ZodType<SecretSetParams> = z
  .object({
    name: z.string().regex(SECRET_NAME_PATTERN),
    // Characters here; the instance also refuses more than 64 KiB of UTF-8.
    value: z.string().min(1).max(SECRET_VALUE_MAX),
    artifact: ArtifactRef.exactOptional(),
  })
  .register(wireRegistry, {
    id: "SecretSetParams",
    description: "A secret's name, value and optional artifact scope.",
  });

/**
 * `secret/set`: stores a named secret in the home's owner-only store (D44), for one artifact or
 * for every artifact of the home; server code reads it with `secret(name)`. Setting it again
 * replaces the value. Setting is idempotent by nature, so it takes no `requestId`: the ledger
 * never records anything derived from a secret's value.
 */
export const secretSetMethod: MethodDefinition<SecretSetParams, SecretSetResult> = defineMethod({
  method: "secret/set",
  direction: "client-to-instance",
  mutating: false,
  params,
  result: SecretEntry,
});
