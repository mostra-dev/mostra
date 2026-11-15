import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/** The params of `plugin/export` (INTERFACES §14). */
export interface PluginExportParams {
  /** The artifact: its ID, or a source path it was published from. */
  readonly artifact: ArtifactRef;
  /** The version: a number or a version ID; the latest when absent. */
  readonly version?: number | string;
  /** The exporter's ID: one the artifact's plugins or the home's contribute. */
  readonly exporter: string;
  /** Where: an absolute path, which must not exist yet, or be an empty directory. */
  readonly out: string;
  /** The exporter's options, as JSON its `options` schema describes. */
  readonly options?: Readonly<Record<string, unknown>>;
}

/** The result of `plugin/export`. */
export interface PluginExportResult {
  /** What it wrote, as absolute paths. */
  readonly files: readonly string[];
  /** The file to open first, when the exporter names one. */
  readonly entry?: string;
  /** The version exported. */
  readonly versionId: string;
  /** The exporter, and the plugin that contributes it. */
  readonly exporter: { readonly id: string; readonly package: string };
  /** What the exporter reported, in its own codes (`@mostra/contract-exporter`'s `Finding`). */
  readonly findings: readonly PluginFinding[];
}

/** Something a plugin's contribution reported, in the plugin's own code. */
export interface PluginFinding {
  /** The plugin's code: upper-case letters, digits and `_`. */
  readonly code: string;
  /** How serious it is: `error` means the export is wrong, `warning` and `hint` inform. */
  readonly severity: "error" | "warning" | "hint";
  /** What it found. */
  readonly message: string;
  /** What to do, in one sentence. */
  readonly hint?: string;
  /** Where, in the version's files. */
  readonly location?: { readonly file: string; readonly line?: number; readonly column?: number };
}

const PluginFinding: z.ZodType<PluginFinding> = z
  .object({
    code: z.string().min(1).max(64),
    severity: z.enum(["error", "warning", "hint"]),
    message: z.string(),
    hint: z.string().exactOptional(),
    location: z
      .object({
        file: z.string(),
        line: z.int().min(1).exactOptional(),
        column: z.int().min(1).exactOptional(),
      })
      .exactOptional(),
  })
  .register(wireRegistry, {
    id: "PluginFinding",
    description: "Something a plugin's contribution reported, in the plugin's own code.",
  });

const params: z.ZodType<PluginExportParams> = z
  .object({
    artifact: ArtifactRef,
    version: z.union([z.int().min(1), z.string().min(1)]).exactOptional(),
    exporter: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
    out: z.string().min(1),
    options: z.record(z.string(), z.unknown()).exactOptional(),
  })
  .register(wireRegistry, { id: "PluginExportParams" });

const result: z.ZodType<PluginExportResult> = z
  .object({
    files: z.array(z.string()).readonly(),
    entry: z.string().exactOptional(),
    versionId: z.string(),
    exporter: z.object({ id: z.string(), package: z.string() }),
    findings: z.array(PluginFinding).readonly(),
  })
  .register(wireRegistry, { id: "PluginExportResult" });

/**
 * `plugin/export`: runs an exporter a plugin contributes (`@mostra/contract-exporter`) on a
 * published version's client build, in a plugin child of the instance, and writes the files it
 * returns under `out`. `mostra export --as <id>` calls it for every exporter Mostra doesn't build
 * in.
 */
export const pluginExportMethod: MethodDefinition<PluginExportParams, PluginExportResult> =
  defineMethod({
    method: "plugin/export",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
