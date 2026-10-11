/**
 * Artifacts and versions as clients see them (INTERFACES §6): how a client names an artifact or its
 * source, and the summaries `artifact/list`, `artifact/get` and `artifact/publish` return.
 */
import * as z from "zod";
import { ArtifactId, Cursor, VersionId } from "./ids.ts";
import { ArtifactLink, ArtifactManifest, SubmissionPolicy } from "./manifest.ts";
import { wireRegistry } from "./wire-registry.ts";

/** An absolute file system path: the client resolves relative paths against its own directory. */
const AbsolutePath = z.string().regex(/^\//);

/**
 * Where to build an artifact from: a source path (a `.tsx`, `.jsx` or `.mdx` file, or a directory
 * with an `index` entry), or an artifact ID, meaning the path it was last published from.
 */
export type SourceRef = { readonly path: string } | { readonly artifactId: string };

/** Names an artifact: by its ID, or by a source path bound to it. */
export type ArtifactRef = { readonly artifactId: string } | { readonly path: string };

/** The Zod schema of the `SourceRef` type. */
export const SourceRef: z.ZodType<SourceRef> = z
  .union([z.object({ path: AbsolutePath }), z.object({ artifactId: ArtifactId.schema })])
  .register(wireRegistry, {
    id: "SourceRef",
    description:
      "Where to build an artifact from: an absolute source path, or an artifact ID (its last published source path).",
  });

/** The Zod schema of the `ArtifactRef` type. */
export const ArtifactRef: z.ZodType<ArtifactRef> = z
  .union([z.object({ artifactId: ArtifactId.schema }), z.object({ path: AbsolutePath })])
  .register(wireRegistry, {
    id: "ArtifactRef",
    description: "Names an artifact by its ID or by an absolute source path bound to it.",
  });

/** One published version. */
export interface VersionSummary {
  /** The content-addressed version ID (D89). */
  readonly id: string;
  /** The per-artifact version number, for people: 1, 2, 3 … */
  readonly number: number;
  /** When it was published (RFC 3339, UTC). */
  readonly publishedAt: string;
  /** SHA-256 of the source tree's canonical listing, lowercase hex (DATA_MODEL §2). */
  readonly sourceDigest: string;
  /** SHA-256 of the build environment's canonical JSON, lowercase hex (DATA_MODEL §2). */
  readonly envDigest: string;
  /** SHA-256 of the build output's canonical listing: recorded, never identity (VR-01). */
  readonly outputDigest: string;
  /** Diagnostic codes a forced publish recorded (D41); absent when none. */
  readonly forcedDiagnostics?: readonly string[];
}

/** One artifact, as `artifact/list` returns it. Metadata comes from the latest version's manifest. */
export interface ArtifactSummary {
  /** The artifact ID. */
  readonly id: string;
  /** The title people see. */
  readonly title: string;
  /** What the artifact is for. */
  readonly description?: string;
  /** What kind of artifact it is. */
  readonly family?: string;
  /** Related artifacts. */
  readonly links: readonly ArtifactLink[];
  /** The render mode of the latest version. */
  readonly mode: "spa";
  /** The submission policy requested at publish or in the manifest; the host decides (D39). */
  readonly policy?: SubmissionPolicy;
  /** The source path the artifact was last published from. */
  readonly source?: string;
  /** When the artifact was first published (RFC 3339, UTC). */
  readonly createdAt: string;
  /** The version viewers are offered. */
  readonly latestVersion?: VersionSummary;
}

/** One artifact in full, as `artifact/get` returns it. */
export interface ArtifactDetail extends ArtifactSummary {
  /** The latest version's manifest. */
  readonly manifest: ArtifactManifest;
  /** Every version, newest number first. */
  readonly versions: readonly VersionSummary[];
}

/**
 * The receipt of `artifact/publish` (INTERFACES §6, H-07). Everything it names is durable before the
 * response is sent.
 */
export interface PublishReceipt {
  /** The artifact the version belongs to. */
  readonly artifactId: string;
  /** The content-addressed version ID (D89). */
  readonly versionId: string;
  /** The version number. */
  readonly version: number;
  /**
   * The capability URL. Present once the instance serves views (the gateway, WP-05); optional on
   * the wire so instances without it can publish (D90).
   */
  readonly url?: string;
  /** The event cursor of the version's `version.published` event; `wait` and events read after it. */
  readonly cursor: string;
  /** `true` when this artifact already had this exact source and environment as a version. */
  readonly reused: boolean;
  /** The error codes a forced publish recorded (D41). */
  readonly forcedDiagnostics?: readonly string[];
}

/** The Zod schema of the `VersionSummary` type. */
export const VersionSummary: z.ZodType<VersionSummary> = z
  .object({
    id: VersionId.schema,
    number: z.int().min(1),
    publishedAt: z.iso.datetime(),
    sourceDigest: z.string().regex(/^[0-9a-f]{64}$/),
    envDigest: z.string().regex(/^[0-9a-f]{64}$/),
    outputDigest: z.string().regex(/^[0-9a-f]{64}$/),
    forcedDiagnostics: z.array(z.string()).readonly().exactOptional(),
  })
  .register(wireRegistry, { id: "VersionSummary", description: "One published version." });

const summaryShape = {
  id: ArtifactId.schema,
  title: z.string(),
  description: z.string().exactOptional(),
  family: z.string().exactOptional(),
  links: z.array(ArtifactLink).readonly(),
  mode: z.literal("spa"),
  policy: SubmissionPolicy.exactOptional(),
  source: z.string().exactOptional(),
  createdAt: z.iso.datetime(),
  latestVersion: VersionSummary.exactOptional(),
};

/** The Zod schema of the `ArtifactSummary` type. */
export const ArtifactSummary: z.ZodType<ArtifactSummary> = z
  .object(summaryShape)
  .register(wireRegistry, {
    id: "ArtifactSummary",
    description: "One artifact: metadata from its latest version, its source and latest version.",
  });

/** The Zod schema of the `ArtifactDetail` type. */
export const ArtifactDetail: z.ZodType<ArtifactDetail> = z
  .object({
    ...summaryShape,
    manifest: ArtifactManifest,
    versions: z.array(VersionSummary).readonly(),
  })
  .register(wireRegistry, {
    id: "ArtifactDetail",
    description: "One artifact in full: its summary, the latest manifest and every version.",
  });

/** The Zod schema of the `PublishReceipt` type. */
export const PublishReceipt: z.ZodType<PublishReceipt> = z
  .object({
    artifactId: ArtifactId.schema,
    versionId: VersionId.schema,
    version: z.int().min(1),
    url: z.string().exactOptional(),
    cursor: Cursor.schema,
    reused: z.boolean(),
    forcedDiagnostics: z.array(z.string()).readonly().exactOptional(),
  })
  .register(wireRegistry, {
    id: "PublishReceipt",
    description:
      "The receipt of artifact/publish: artifact, version, number, capability URL when served, event cursor, reuse.",
  });
