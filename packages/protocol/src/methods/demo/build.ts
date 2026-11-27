import * as z from "zod";
import { SourceRef } from "../../artifact.ts";
import { Diagnostic } from "../../diagnostics/diagnostic.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `demo/build` (INTERFACES §6, D185 item 4). */
export interface DemoBuildParams {
  /** The artifact whose demos to build: its source path, or its ID. */
  readonly source: SourceRef;
  /** One demo, by its name in the manifest; every demo when absent. */
  readonly demo?: string;
  /** Build even when the cache holds a build of the same source, command, settings and base. */
  readonly force?: boolean;
}

/** One demo's build. */
export interface DemoBuildOutcome {
  /** The demo's name in the manifest. */
  readonly name: string;
  /** `built` ran the build now; `cached` found the same build in the cache; `failed` didn't build. */
  readonly status: "built" | "cached" | "failed";
  /** The SHA-256 of the demo's inputs: its source content, command, settings and base. */
  readonly digest?: string;
  /** How many files its output holds. */
  readonly files?: number;
  /** How long the build ran, in milliseconds (0 when cached). */
  readonly ms?: number;
  /** Why it failed, with the build's last log lines: `MOSTRA_DEMO_*`. */
  readonly diagnostics: readonly Diagnostic[];
}

/** The result of `demo/build`. */
export interface DemoBuildResult {
  /** Each demo built, in the manifest's order. */
  readonly demos: readonly DemoBuildOutcome[];
}

const params: z.ZodType<DemoBuildParams> = z
  .object({
    source: SourceRef,
    demo: z.string().min(1).exactOptional(),
    force: z.boolean().exactOptional(),
  })
  .register(wireRegistry, { id: "DemoBuildParams" });

const outcome: z.ZodType<DemoBuildOutcome> = z
  .object({
    name: z.string(),
    status: z.enum(["built", "cached", "failed"]),
    digest: z.string().exactOptional(),
    files: z.int().min(0).exactOptional(),
    ms: z.number().min(0).exactOptional(),
    diagnostics: z.array(Diagnostic).readonly(),
  })
  .register(wireRegistry, { id: "DemoBuildOutcome" });

const result: z.ZodType<DemoBuildResult> = z
  .object({ demos: z.array(outcome).readonly() })
  .register(wireRegistry, { id: "DemoBuildResult" });

/**
 * `demo/build`: builds an artifact's demos now (D185 item 4), as `verify` and publish do, into the
 * home's cache, so the next `verify` and publish reuse them; each outcome says what failed.
 */
export const demoBuildMethod: MethodDefinition<DemoBuildParams, DemoBuildResult> = defineMethod({
  method: "demo/build",
  direction: "client-to-instance",
  mutating: false,
  params,
  result,
});
