import * as z from "zod";
import { AbsolutePath, SourceRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { PluginScope } from "../../plugins.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `plugin/commands` (INTERFACES §14). */
export interface PluginCommandsParams {
  /** The artifact whose plugins' commands count too, besides the home's. */
  readonly artifact?: SourceRef;
}

/** One CLI command a plugin contributes, where its definition loads from. */
export interface PluginCommandInfo {
  /** Its words after `mostra`, joined by spaces: `term record`. */
  readonly command: string;
  /** The plugin's npm package. */
  readonly package: string;
  /** Its installed version. */
  readonly version: string;
  /** Whether the artifact's lockfile or the home's records it. */
  readonly scope: PluginScope;
  /** The module that exports its definition (absolute). */
  readonly file: string;
  /** The export that holds it. */
  readonly export: string;
}

/** The result of `plugin/commands`. */
export interface PluginCommandsResult {
  /** Every command the home's plugins and the artifact's contribute, those that load. */
  readonly commands: readonly PluginCommandInfo[];
}

const params: z.ZodType<PluginCommandsParams> = z
  .object({ artifact: SourceRef.exactOptional() })
  .register(wireRegistry, { id: "PluginCommandsParams" });

const PluginCommandInfo: z.ZodType<PluginCommandInfo> = z
  .object({
    command: z.string().min(1),
    package: z.string().min(1),
    version: z.string().min(1),
    scope: PluginScope,
    file: AbsolutePath,
    export: z.string().min(1),
  })
  .register(wireRegistry, { id: "PluginCommandInfo" });

const result: z.ZodType<PluginCommandsResult> = z
  .object({ commands: z.array(PluginCommandInfo).readonly() })
  .register(wireRegistry, { id: "PluginCommandsResult" });

/**
 * `plugin/commands`: the CLI commands plugins contribute (`@mostra/contract-cli-command`), the
 * home's and an artifact's, with the module each loads from. The CLI runs a command it doesn't
 * know as one of them, in its own process, as a git subcommand runs: the command talks to the
 * instance through the CLI's own session.
 */
export const pluginCommandsMethod: MethodDefinition<PluginCommandsParams, PluginCommandsResult> =
  defineMethod({
    method: "plugin/commands",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
