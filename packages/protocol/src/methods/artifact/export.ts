import * as z from "zod";
import { ArtifactRef } from "../../artifact.ts";
import { Diagnostic } from "../../diagnostics/diagnostic.ts";
import { defineMethod, type MethodDefinition } from "../../method.ts";
import { wireRegistry } from "../../wire-registry.ts";

/**
 * An export class (ARCHITECTURE §3, VR-07). `bundle` is the portable artifact package (RM-01,
 * WP-29); WP-24 adds `static`, `html` and `snapshot` (D185 items 7 and 8), and WP-17 `mcp-app`
 * through its plugin, additively.
 */
export type ExportClass = "bundle" | "static" | "html" | "snapshot";

/** The Zod schema of the `ExportClass` type. */
export const ExportClass: z.ZodType<ExportClass> = z
  .enum(["bundle", "static", "html", "snapshot"])
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
   * Where: an absolute path. A bundle or a snapshot is a directory there, or one archive when the
   * path ends in `.tar.zst`; `static` a directory; `html` one file. It must not exist yet, or be an
   * empty directory.
   */
  readonly out: string;
  /**
   * `static` and `snapshot`: the path the folder will be served from (`/my-repo/`), under which
   * each demo is built again so it works fully there (D185 item 7).
   */
  readonly base?: string;
  /** Make every warning of the export an error, writing nothing (`MOSTRA_TARGET_EXPORT_STRICT`). */
  readonly strict?: boolean;
  /** `snapshot`: freeze this submission's answers and state instead of the home's viewer's. */
  readonly submission?: string;
  /** `snapshot`: `false` leaves the artifact's shared state out. Default `true`. */
  readonly sharedState?: boolean;
}

/** How an export carries one demo (D185 item 7). */
export interface ExportedDemo {
  /** The demo's name in the manifest. */
  readonly name: string;
  /** How it moves between its pages. */
  readonly routing: "history" | "hash";
  /**
   * `full`: fully, wherever the export is opened; `root`: fully at a host's root (or under the
   * export's `base`), on its opening page from disk or another path; `folder-only`: not in a
   * single file, in the folder export only.
   */
  readonly carried: "full" | "root" | "folder-only";
  /** The path it was built under for this export, when `base` rebuilt it. */
  readonly base?: string;
}

/** What an export carries and what it loses (D185 items 7 and 8). */
export interface ExportReport {
  /** The export class. */
  readonly as: ExportClass;
  /** What the page loses here: named actions, live sources, and Submit. */
  readonly unavailable: {
    readonly actions: readonly string[];
    readonly live: readonly string[];
    readonly submit: boolean;
  };
  /** Each resource the export couldn't hold, which needs a network where it is opened. */
  readonly notInlined: readonly string[];
  /** Each demo, and how it is carried. */
  readonly demos: readonly ExportedDemo[];
  /** `snapshot`: what it froze. */
  readonly snapshot?: {
    /** `viewer`: the home's own viewer's answers; `submission`: that submission's. */
    readonly answers: "viewer" | "submission";
    readonly submission?: string;
    /** The time the values are from. */
    readonly at: string;
    /** Whether the shared state is in it, and how many people's answers it holds. */
    readonly sharedState: { readonly included: boolean; readonly people: number };
    /** The live sources whose last values it holds. */
    readonly live: readonly string[];
    /** Sensitive fields it left out, by ID. */
    readonly leftOut: readonly string[];
  };
}

/** The result of `artifact/export`. */
export interface ArtifactExportResult {
  /** What it wrote, as absolute paths: the bundle's directory or archive. */
  readonly files: readonly string[];
  /** The version exported. */
  readonly versionId: string;
  /** `static`, `html` and `snapshot`: what the export carries and loses (D185). */
  readonly report?: ExportReport;
  /** What an agent should know about the export, also when it succeeded (D185 item 8). */
  readonly warnings?: readonly Diagnostic[];
}

const params: z.ZodType<ArtifactExportParams> = z
  .object({
    artifact: ArtifactRef,
    version: z.union([z.int().min(1), z.string().min(1)]).exactOptional(),
    as: ExportClass,
    out: z.string().min(1),
    base: z
      .string()
      .regex(/^\/([^/?#\s]+\/)*$/)
      .exactOptional(),
    strict: z.boolean().exactOptional(),
    submission: z.string().min(1).exactOptional(),
    sharedState: z.boolean().exactOptional(),
  })
  .register(wireRegistry, { id: "ArtifactExportParams" });

const ExportedDemo: z.ZodType<ExportedDemo> = z
  .object({
    name: z.string(),
    routing: z.enum(["history", "hash"]),
    carried: z.enum(["full", "root", "folder-only"]),
    base: z.string().exactOptional(),
  })
  .register(wireRegistry, { id: "ExportedDemo" });

const ExportReport: z.ZodType<ExportReport> = z
  .object({
    as: ExportClass,
    unavailable: z.object({
      actions: z.array(z.string()).readonly(),
      live: z.array(z.string()).readonly(),
      submit: z.boolean(),
    }),
    notInlined: z.array(z.string()).readonly(),
    demos: z.array(ExportedDemo).readonly(),
    snapshot: z
      .object({
        answers: z.enum(["viewer", "submission"]),
        submission: z.string().exactOptional(),
        at: z.string(),
        sharedState: z.object({ included: z.boolean(), people: z.int().min(0) }),
        live: z.array(z.string()).readonly(),
        leftOut: z.array(z.string()).readonly(),
      })
      .exactOptional(),
  })
  .register(wireRegistry, { id: "ExportReport" });

const result: z.ZodType<ArtifactExportResult> = z
  .object({
    files: z.array(z.string()).readonly(),
    versionId: z.string(),
    report: ExportReport.exactOptional(),
    warnings: z.array(Diagnostic).readonly().exactOptional(),
  })
  .register(wireRegistry, { id: "ArtifactExportResult" });

/**
 * `artifact/export`: writes a published version out of the home. A `bundle` carries the version's
 * builds, manifest, lockfile and source snapshot, so `artifact/import` (`mostra run <bundle>`) in
 * another home makes it the same version, with the same artifact and version IDs (RM-01). `static`,
 * `html` and `snapshot` carry the page's front end and its demos, never its server code, and report
 * what they lose (D185).
 */
export const artifactExportMethod: MethodDefinition<ArtifactExportParams, ArtifactExportResult> =
  defineMethod({
    method: "artifact/export",
    direction: "client-to-instance",
    mutating: false,
    params,
    result,
  });
