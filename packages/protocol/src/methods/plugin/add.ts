import * as z from "zod";
import { SourceRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { LicenseDisclosure, PluginSummary } from "../../plugins.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `plugin/add` (INTERFACES §14). */
export interface PluginAddParams {
  /** The artifact whose lockfile records the plugins; exactly one of `artifact` and `home`. */
  readonly artifact?: SourceRef;
  /** Install for the whole home instead (exporters and CLI commands only, ROUND-3 §6.4). */
  readonly home?: boolean;
  /** npm specs of the plugins: `name`, `name@version`, `name@range` or `name@tag`. */
  readonly packages: readonly string[];
  /**
   * Licenses acknowledged for this install (`LicenseRef-Remotion`), as `--accept-license` gives
   * them (D31): recorded in the lockfile with when.
   */
  readonly acceptLicenses?: readonly string[];
  /** Makes retries idempotent: a repeated `requestId` returns the recorded result (H-03). */
  readonly requestId?: string;
}

/** The result of `plugin/add`. */
export interface PluginAddResult {
  /** The scope's plugins after the change, in load order (the order they were added). */
  readonly plugins: readonly PluginSummary[];
  /** The packages this call added or moved to another version. */
  readonly added: readonly string[];
  /** Every license the added plugins bring, with its class, shown before anything was recorded. */
  readonly licenses: readonly LicenseDisclosure[];
  /** The SHA-256 of the scope's lockfile after the change: an artifact's next publish uses it. */
  readonly lockDigest: string;
}

const params: z.ZodType<PluginAddParams> = z
  .object({
    artifact: SourceRef.exactOptional(),
    home: z.boolean().exactOptional(),
    packages: z.array(z.string().min(1)).min(1).readonly(),
    acceptLicenses: z.array(z.string().min(1).max(256)).readonly().exactOptional(),
    requestId: z.string().min(1).exactOptional(),
  })
  .register(wireRegistry, { id: "PluginAddParams" });

const result: z.ZodType<PluginAddResult> = z
  .object({
    plugins: z.array(PluginSummary).readonly(),
    added: z.array(z.string()).readonly(),
    licenses: z.array(LicenseDisclosure).readonly(),
    lockDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .register(wireRegistry, { id: "PluginAddResult" });

/**
 * `plugin/add`: installs plugins (npm packages with a `"mostra"` manifest) for an artifact or the
 * home (EX-01, EX-04, ROUND-3 §6.4). Each must implement contract ranges this release serves,
 * contribute IDs no other plugin of the scope has, and export stamped definitions; every license
 * its installed dependencies bring is classed, and one that needs an acknowledgment refuses the
 * install (`MOSTRA_LICENSE_UNACCEPTED`) unless `acceptLicenses` or the home's policy accepts it.
 * Nothing is recorded until all of that holds; then the plugins, in load order, and the
 * acknowledgments join the lockfile in one step. The method behind `mostra plugin add`.
 */
export const pluginAddMethod: MethodDefinition<PluginAddParams, PluginAddResult> = defineMethod({
  method: "plugin/add",
  direction: "client-to-instance",
  mutating: true,
  params,
  result,
});
