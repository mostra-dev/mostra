/**
 * Expected-failure baselines (HO-05): a host that knows it fails some scenarios today records them,
 * with why, so a run stays green while the gap is known and goes red the moment anything changes:
 * a scenario that newly fails, or one the baseline expects to fail that passes (the baseline is
 * then stale and must shrink). The pattern of the MCP conformance suite and WPT's expectations.
 *
 * ```json
 * { "schemaVersion": 1, "expectedFailures": { "delivery.exactly-once": "our store isn't idempotent yet (#123)" } }
 * ```
 */
import { readFileSync } from "node:fs";
import * as z from "zod";

/** A baseline: the scenarios a host is expected to fail, each with its reason. */
export interface Baseline {
  /** The baseline format's version: 1. */
  readonly schemaVersion: 1;
  /** Each expected failure: the scenario's ID and why it fails. */
  readonly expectedFailures: Readonly<Record<string, string>>;
}

const BaselineSchema: z.ZodType<Baseline> = z.strictObject({
  schemaVersion: z.literal(1),
  expectedFailures: z.record(z.string().min(1), z.string().min(1)),
});

/** An empty baseline: every scenario must pass. */
export const NO_BASELINE: Baseline = { schemaVersion: 1, expectedFailures: {} };

/**
 * Reads a baseline file. Throws on a file that isn't one, and on a scenario ID no scenario of
 * `known` has (a typo would otherwise expect nothing, silently).
 */
export function readBaseline(path: string, known: readonly string[]): Baseline {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} isn't a readable JSON baseline: ${(error as Error).message}`);
  }
  const parsed = BaselineSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `${path} isn't a conformance baseline: { "schemaVersion": 1, "expectedFailures": { "<scenario>": "<why>" } }.`,
    );
  }
  const unknown = Object.keys(parsed.data.expectedFailures).filter((id) => !known.includes(id));
  if (unknown.length > 0)
    throw new Error(`${path} names scenarios the kit doesn't have: ${unknown.join(", ")}.`);
  return parsed.data;
}
