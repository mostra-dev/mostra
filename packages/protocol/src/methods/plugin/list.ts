import * as z from "zod";
import { SourceRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { LicenseDisclosure, PluginSummary } from "../../plugins.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `plugin/list` (INTERFACES §14). */
export interface PluginListParams {
  /** The artifact whose plugins to list; exactly one of `artifact` and `home`. */
  readonly artifact?: SourceRef;
  /** List the home's own plugins instead. */
  readonly home?: boolean;
}

/** The result of `plugin/list`. */
export interface PluginListResult {
  /** The scope's plugins in load order, each checked against this release as it is now. */
  readonly plugins: readonly PluginSummary[];
  /** Every license they bring, and where its acknowledgment stands. */
  readonly licenses: readonly LicenseDisclosure[];
}

const params: z.ZodType<PluginListParams> = z
  .object({ artifact: SourceRef.exactOptional(), home: z.boolean().exactOptional() })
  .register(wireRegistry, { id: "PluginListParams" });

const result: z.ZodType<PluginListResult> = z
  .object({
    plugins: z.array(PluginSummary).readonly(),
    licenses: z.array(LicenseDisclosure).readonly(),
  })
  .register(wireRegistry, { id: "PluginListResult" });

/**
 * `plugin/list`: an artifact's plugins, or the home's, in load order, each loaded as `verify`
 * and `publish` would load it now, with the licenses they bring. The method behind
 * `mostra plugin list`.
 */
export const pluginListMethod: MethodDefinition<PluginListParams, PluginListResult> = defineMethod({
  method: "plugin/list",
  direction: "client-to-instance",
  mutating: false,
  params,
  result,
});
