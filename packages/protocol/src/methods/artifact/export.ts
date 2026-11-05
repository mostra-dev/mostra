import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/**
 * An export class (ARCHITECTURE §3, VR-07). `bundle` is the portable artifact package (RM-01,
 * WP-29); WP-24 adds `static`, `html` and `snapshot`, and WP-17 `mcp-app`, additively.
 */
export type ExportClass = "bundle";

/** The Zod schema of the `ExportClass` type. */
export const ExportClass: z.ZodType<ExportClass> = z
  .enum(["bundle"])
  .register(wireRegistry, { id: "ExportClass", description: "An export class (VR-07)." });

/** The params of `artifact/export` (INTERFACES §6, §15). */
export interface ArtifactExportParams {
  /** The artifact: its ID, or a source path it was published from. */
  readonly artifact: ArtifactRef;
  /** The version: a number or a version ID; the latest when absent. */
  readonly version?: number | string;
  /** What to write. */
  readonly as: ExportClass;
  /**
   * Where: an absolute path. A bundle is a directory there, or one archive when the path ends in
   * `.tar.zst`. It must not exist yet, or be an empty directory.
   */
  readonly out: string;
}

/** The result of `artifact/export`. */
export interface ArtifactExportResult {
  /** What it wrote, as absolute paths: the bundle's directory or archive. */
  readonly files: readonly string[];
  /** The version exported. */
  readonly versionId: string;
}

const params: z.ZodType<ArtifactExportParams> = z
  .object({
    artifact: ArtifactRef,
    version: z.union([z.int().min(1), z.string().min(1)]).exactOptional(),
    as: ExportClass,
    out: z.string().min(1),
  })
  .register(wireRegistry, { id: "ArtifactExportParams" });

const result: z.ZodType<ArtifactExportResult> = z
  .object({
    files: z.array(z.string()).readonly(),
    versionId: z.string(),
  })
  .register(wireRegistry, { id: "ArtifactExportResult" });

/**
 * `artifact/export`: writes a published version out of the home. A `bundle` carries the version's
 * builds, manifest, lockfile and source snapshot, so `artifact/import` (`mostra run <bundle>`) in
 * another home makes it the same version, with the same artifact and version IDs (RM-01).
 */
export const artifactExportMethod: MethodDefinition<ArtifactExportParams, ArtifactExportResult> =
  defineMethod({
    method: "artifact/export",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
