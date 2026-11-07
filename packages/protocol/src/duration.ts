/**
 * Durations as INTERFACES §1 writes them in flags and manifests: a module of its own, so the
 * manifest and capability links share it without either pulling the other into a browser bundle.
 */
import * as z from "zod";
import { wireRegistry } from "./wire-registry.ts";

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
