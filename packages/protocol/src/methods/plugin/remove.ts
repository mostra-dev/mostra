import * as z from "zod";
import { SourceRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { PluginSummary } from "../../plugins.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `plugin/remove` (INTERFACES §14). */
export interface PluginRemoveParams {
  /** The artifact whose plugins to remove; exactly one of `artifact` and `home`. */
  readonly artifact?: SourceRef;
  /** Remove from the home's own plugins instead. */
  readonly home?: boolean;
  /** The plugins' package names. */
  readonly packages: readonly string[];
  /** Makes retries idempotent: a repeated `requestId` returns the recorded result (H-03). */
  readonly requestId?: string;
}

/** The result of `plugin/remove`. */
export interface PluginRemoveResult {
  /** The packages removed. */
  readonly removed: readonly string[];
  /** The scope's plugins after the change, in load order. */
  readonly plugins: readonly PluginSummary[];
  /** The SHA-256 of the scope's lockfile after the change. */
  readonly lockDigest: string;
}

const params: z.ZodType<PluginRemoveParams> = z
  .object({
    artifact: SourceRef.exactOptional(),
    home: z.boolean().exactOptional(),
    packages: z.array(z.string().min(1)).min(1).readonly(),
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "PluginRemoveParams" });

const result: z.ZodType<PluginRemoveResult> = z
  .object({
    removed: z.array(z.string()).readonly(),
    plugins: z.array(PluginSummary).readonly(),
    lockDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .register(wireRegistry, { id: "PluginRemoveResult" });

/**
 * `plugin/remove`: takes plugins out of an artifact's lockfile (or the home's), with the license
 * acknowledgments no remaining plugin needs; a package the artifact's source still imports stays
 * in its lockfile as an ordinary package. The method behind `mostra plugin remove`.
 */
export const pluginRemoveMethod: MethodDefinition<PluginRemoveParams, PluginRemoveResult> =
  defineMethod({
    method: "plugin/remove",
    direction: "client-to-instance",
    mutating: true,
    params,
    result,
  });
