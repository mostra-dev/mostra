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
 * - `action:*`: run every server function; `action:<export>` runs that export of any
 *   `"use server"` module; `action:<module path>#<export>` runs one function ID.
 */
export type CapabilityScope = "view" | "draft" | "submit" | "review" | `action:${string}`;

/** The Zod schema of the `CapabilityScope` type. */
export const CapabilityScope: z.ZodType<CapabilityScope> = z
  .string()
  .regex(/^(view|draft|submit|review|action:(\*|[^\s#*]+(#[^\s#*]+)?))$/)
  .register(wireRegistry, {
    id: "CapabilityScope",
    description:
      "A capability token's scope: view, draft, submit, review, action:*, action:<export> or action:<module path>#<export>.",
  }) as z.ZodType<CapabilityScope>;

/** Every scope at once: what a link minted without `scopes`, and every default link, carries. */
export const ALL_SCOPES: readonly CapabilityScope[] = [
  "view",
  "draft",
  "submit",
  "review",
  "action:*",
];

/**
 * A duration: a positive whole number and a unit, `s`, `m`, `h` or `d` (`30m`, `24h`, `7d`), as
 * INTERFACES §1 writes durations in flags and manifests.
 */
export type Duration = `${number}${"s" | "m" | "h" | "d"}`;

/** The Zod schema of the `Duration` type. */
export const Duration: z.ZodType<Duration> = z
  .string()
  .regex(/^[1-9][0-9]{0,8}[smhd]$/)
  .register(wireRegistry, {
    id: "Duration",
    description: "A duration: a positive whole number and s, m, h or d, such as 30m, 24h or 7d.",
  }) as z.ZodType<Duration>;

const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** The length of a `Duration` in milliseconds. */
export function durationMs(duration: Duration): number {
  const unit = duration.slice(-1) as keyof typeof UNIT_MS;
  return Number(duration.slice(0, -1)) * UNIT_MS[unit];
}

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
