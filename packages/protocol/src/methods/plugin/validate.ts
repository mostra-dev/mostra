import * as z from "zod";
import { AbsolutePath } from "../../artifact.ts";
import { Diagnostic } from "../../diagnostics/diagnostic.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { PluginSummary } from "../../plugins.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `plugin/validate` (INTERFACES §14). */
export interface PluginValidateParams {
  /** The plugin's package directory, which holds its `package.json` (absolute). */
  readonly path: string;
  /**
   * Licenses acknowledged for what the package brings (D31): its entries are loaded only once
   * every license that needs an acknowledgment has one, as an install would load them.
   */
  readonly acceptLicenses?: readonly string[];
}

/** The result of `plugin/validate`. */
export interface PluginValidateResult {
  /** Whether the plugin loads in this release: no diagnostic is an error. */
  readonly valid: boolean;
  /** The plugin as Mostra reads it, when its manifest has no error. */
  readonly plugin?: PluginSummary;
  /**
   * Every problem, each with its location in `package.json` or the module it concerns: the
   * manifest's fields, contract ranges, entries and their stamps, licenses.
   */
  readonly diagnostics: readonly Diagnostic[];
}

const params: z.ZodType<PluginValidateParams> = z
  .object({
    path: AbsolutePath,
    acceptLicenses: z.array(z.string().min(1).max(256)).readonly().exactOptional(),
  })
  .register(wireRegistry, { id: "PluginValidateParams" });

const result: z.ZodType<PluginValidateResult> = z
  .object({
    valid: z.boolean(),
    plugin: PluginSummary.exactOptional(),
    diagnostics: z.array(Diagnostic).readonly(),
  })
  .register(wireRegistry, { id: "PluginValidateResult" });

/**
 * `plugin/validate`: checks a plugin package as Mostra would load it (EX-02), reporting every
 * invalid field of its `"mostra"` manifest, every contract range this release doesn't implement,
 * and every entry that doesn't export a definition stamped with its contract, without installing
 * anything. The method behind `mostra plugin validate`.
 */
export const pluginValidateMethod: MethodDefinition<PluginValidateParams, PluginValidateResult> =
  defineMethod({
    method: "plugin/validate",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
