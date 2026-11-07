/**
 * Capability links (D06, D97): the scopes a capability token grants and how long it lasts. A
 * token is the authorization: whoever holds its link may do what its scopes allow, and nothing
 * else limits an artifact or its viewers (D05).
 */
import * as z from "zod";
import { wireRegistry } from "./wire-registry.ts";

/**
 * What a capability token allows (HY-03, D97):
 * - `view`: open the artifact; every token has it.
 * - `draft`: save answers and other field values.
 * - `submit`: submit.
 * - `review`: comment and choose.
 * - `signal`: raise a signal for the host's attention (D10), which a waiting agent may act on.
 * - `action:*`: run every server function; `action:<export>` runs that export of any
 *   `"use server"` module; `action:<module path>#<export>` runs one function ID.
 */
export type CapabilityScope =
  | "view"
  | "draft"
  | "submit"
  | "review"
  | "signal"
  | `action:${string}`;

/** The Zod schema of the `CapabilityScope` type. */
export const CapabilityScope: z.ZodType<CapabilityScope> = z
  .string()
  .regex(/^(view|draft|submit|review|signal|action:(\*|[^\s#*]+(#[^\s#*]+)?))$/)
  .register(wireRegistry, {
    id: "CapabilityScope",
    description:
      "A capability token's scope: view, draft, submit, review, signal, action:*, action:<export> or action:<module path>#<export>.",
  }) as z.ZodType<CapabilityScope>;

/** Every scope at once: what a link minted without `scopes`, and every default link, carries. */
export const ALL_SCOPES: readonly CapabilityScope[] = [
  "view",
  "draft",
  "submit",
  "review",
  "signal",
  "action:*",
];

/**
 * The scopes a token holds after normalization: `view` added, duplicates removed, sorted, so equal
 * grants compare equal.
 */
export function normalizeScopes(scopes: readonly CapabilityScope[]): CapabilityScope[] {
  return [...new Set<CapabilityScope>(["view", ...scopes])].sort();
}

/**
 * Whether `scopes` grant `required`. A plain scope must be held as written. An action scope
 * `action:<module path>#<export>` is granted by `action:*`, by `action:<export>` and by itself.
 */
export function scopeAllows(
  scopes: readonly CapabilityScope[],
  required: CapabilityScope,
): boolean {
  if (scopes.includes(required)) return true;
  if (!required.startsWith("action:")) return false;
  if (scopes.includes("action:*")) return true;
  const functionId = required.slice("action:".length);
  const hash = functionId.lastIndexOf("#");
  return hash >= 0 && scopes.includes(`action:${functionId.slice(hash + 1)}`);
}
