/**
 * The registry (DATA_MODEL §2, §3): which artifacts and versions exist, which source path each
 * artifact is bound to, and the content-addressed version store on disk. The publish module
 * commits a version through {@link Registry.commit}, one ledger transaction that resolves the
 * artifact's identity, inserts the version, binds the source and appends the events
 * (ARCHITECTURE §3 step 6). `artifact/list` and `artifact/get` read through it.
 */
import {
  type ArtifactDetail,
  type ArtifactManifest,
  type ArtifactRef,
  type ArtifactSummary,
  createDiagnostic,
  RpcError,
  type SubmissionPolicy,
  type VersionSummary,
} from "@mostra/protocol";
import type { Faults } from "../faults.ts";
import { appendEvent } from "../interaction/index.ts";
import type { Ledger, LedgerDb } from "../ledger/index.ts";
import { openVersionStore, type VersionStore } from "./store.ts";

export { removeTree, type VersionStore } from "./store.ts";

interface ArtifactRow {
  id: string;
  title: string;
  family: string | null;
  links_json: string;
  policy_json: string | null;
  created_at: string;
  latest_version_id: string | null;
}

interface VersionRow {
  id: string;
  artifact_id: string;
  number: number;
  source_digest: string;
  env_digest: string;
  output_digest: string;
  manifest_json: string;
  forced_codes_json: string | null;
  published_at: string;
}

/** A version to commit (ARCHITECTURE §3 step 6). */
export interface VersionCommit {
  /** The artifact the publish resolved before building. */
  readonly artifactId: string;
  /** The real path of the source (D51). */
  readonly bindingPath: string;
  /** The manifest's `id`, when it has one. */
  readonly manifestId: string | undefined;
  readonly versionId: string;
  readonly sourceDigest: string;
  readonly envDigest: string;
  /** Absent when the version already exists (a reuse). */
  readonly outputDigest: string | undefined;
  readonly manifest: ArtifactManifest;
  /** The policy the host chose at publish, overriding the manifest's request. */
  readonly policy: SubmissionPolicy | undefined;
  readonly forcedCodes: readonly string[];
  /**
   * Whether `path` still claims `artifactId` in its manifest (D51): a moved source no longer does,
   * a copy still does. Runs inside the transaction, so it must be synchronous.
   */
  readonly stillClaims: (path: string, artifactId: string) => boolean;
  /** Test fault points: `publish:in-commit` runs inside the transaction, before it commits. */
  readonly faults?: Faults;
  /**
   * The publish's `requestId` (H-03): its receipt is recorded in the same transaction, so a retry
   * after any crash replays exactly what the first attempt committed.
   */
  readonly requestId?: string | undefined;
}

/** What a commit recorded. */
export interface CommittedVersion {
  readonly version: number;
  /** The cursor of the version's `version.published` event. */
  readonly cursor: string;
  readonly reused: boolean;
}

/** The registry of one home. */
export interface Registry {
  readonly store: VersionStore;
  /**
   * The artifact a source would publish as, before building (D51): the manifest's `id`, else the
   * artifact its path is bound to, else a new one. {@link Registry.commit} checks it again.
   */
  identityFor(bindingPath: string, manifestId: string | undefined, generate: () => string): string;
  /** The version row of `versionId`, if it was committed. */
  hasVersion(versionId: string): boolean;
  /** Commits a version in one ledger transaction. Throws `MOSTRA_PUBLISH_ID_CONFLICT` for a copied ID. */
  commit(input: VersionCommit): CommittedVersion;
  /** The source path an artifact was last published from. */
  sourceOf(artifactId: string): string | undefined;
  list(filter?: { readonly family?: string }): ArtifactSummary[];
  /** One artifact in full; `MOSTRA_ARTIFACT_NOT_FOUND` when unknown. */
  get(ref: ArtifactRef): ArtifactDetail;
  /** Removes staging, and version directories and snapshots without a ledger row (FAILURE_MODEL §3). */
  recover(): Promise<{ readonly versions: string[]; readonly snapshots: string[] }>;
}

function conflict(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_PUBLISH_ID_CONFLICT", { message }));
}

function notFound(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_ARTIFACT_NOT_FOUND", { message }));
}

const versionSummary = (row: VersionRow): VersionSummary => {
  const forced = row.forced_codes_json ? (JSON.parse(row.forced_codes_json) as string[]) : [];
  return {
    id: row.id,
    number: row.number,
    publishedAt: row.published_at,
    sourceDigest: row.source_digest,
    envDigest: row.env_digest,
    outputDigest: row.output_digest,
    ...(forced.length > 0 ? { forcedDiagnostics: forced } : {}),
  };
};

/** Opens the registry over a home's ledger and version store. */
export async function openRegistry(options: {
  readonly home: string;
  readonly ledger: Ledger;
}): Promise<Registry> {
  const { ledger } = options;
  const store = await openVersionStore(options.home);

  const boundArtifact = (db: LedgerDb, path: string): string | undefined =>
    db.get<{ artifact_id: string }>("SELECT artifact_id FROM source_binding WHERE path = ?", path)
      ?.artifact_id;

  const summary = (
    db: LedgerDb,
    row: ArtifactRow,
  ): { summary: ArtifactSummary; latest: VersionRow | undefined } => {
    const latest = row.latest_version_id
      ? db.get<VersionRow>("SELECT * FROM version WHERE id = ?", row.latest_version_id)
      : undefined;
    const manifest = latest ? (JSON.parse(latest.manifest_json) as ArtifactManifest) : undefined;
    const source = db.get<{ path: string }>(
      "SELECT path FROM source_binding WHERE artifact_id = ? ORDER BY bound_at DESC, path LIMIT 1",
      row.id,
    )?.path;
    const result: ArtifactSummary = {
      id: row.id,
      title: row.title,
      ...(manifest?.description !== undefined ? { description: manifest.description } : {}),
      ...(row.family !== null ? { family: row.family } : {}),
      links: JSON.parse(row.links_json) as ArtifactSummary["links"],
      mode: manifest?.mode ?? "spa",
      ...(row.policy_json ? { policy: JSON.parse(row.policy_json) as SubmissionPolicy } : {}),
      ...(source !== undefined ? { source } : {}),
      createdAt: row.created_at,
      ...(latest ? { latestVersion: versionSummary(latest) } : {}),
    };
    return { summary: result, latest };
  };

  return {
    store,
    identityFor(bindingPath, manifestId, generate) {
      if (manifestId !== undefined) return manifestId;
      return ledger.read((db) => boundArtifact(db, bindingPath)) ?? generate();
    },
    hasVersion(versionId) {
      return ledger.read(
        (db) => db.get("SELECT 1 FROM version WHERE id = ?", versionId) !== undefined,
      );
    },
    commit(input) {
      return ledger.write((db) => {
        const now = new Date().toISOString();
        // Identity (D51): the manifest's id wins; a path bound elsewhere follows it; a moved source
        // rebinds; a copy that still claims the id is a conflict.
        if (input.manifestId !== undefined) {
          const others = db.all<{ path: string }>(
            "SELECT path FROM source_binding WHERE artifact_id = ? AND path != ?",
            input.manifestId,
            input.bindingPath,
          );
          for (const { path } of others) {
            if (input.stillClaims(path, input.manifestId)) {
              throw conflict(
                `${input.bindingPath} and ${path} both claim the artifact ID ${input.manifestId}.`,
              );
            }
            db.run("DELETE FROM source_binding WHERE path = ?", path);
          }
        }
        const resolved =
          input.manifestId ?? boundArtifact(db, input.bindingPath) ?? input.artifactId;
        if (resolved !== input.artifactId) {
          throw new Error(
            `The artifact of ${input.bindingPath} changed during the publish; publish again.`,
          );
        }

        let artifact = db.get<ArtifactRow>("SELECT * FROM artifact WHERE id = ?", input.artifactId);
        if (!artifact) {
          db.run(
            "INSERT INTO artifact (id, title, family, links_json, policy_json, created_at, latest_version_id) VALUES (?, ?, ?, ?, ?, ?, NULL)",
            input.artifactId,
            input.manifest.title,
            input.manifest.family ?? null,
            JSON.stringify(input.manifest.links ?? []),
            null,
            now,
          );
          appendEvent(db, {
            artifactId: input.artifactId,
            type: "artifact.created",
            payload: { title: input.manifest.title, family: input.manifest.family ?? null },
          });
          artifact = db.get<ArtifactRow>(
            "SELECT * FROM artifact WHERE id = ?",
            input.artifactId,
          ) as ArtifactRow;
        }

        const existing = db.get<VersionRow>("SELECT * FROM version WHERE id = ?", input.versionId);
        let number: number;
        let cursor: string | undefined;
        if (existing) {
          number = existing.number;
          if (artifact.latest_version_id === input.versionId) {
            cursor = db
              .get<{ cursor: number }>(
                "SELECT MAX(cursor) AS cursor FROM event WHERE artifact_id = ? AND type = 'version.published' AND json_extract(payload_json, '$.versionId') = ?",
                input.artifactId,
                input.versionId,
              )
              ?.cursor?.toString();
          }
        } else {
          if (input.outputDigest === undefined)
            throw new Error("A new version needs its output digest.");
          number =
            db.get<{ next: number }>(
              "SELECT COALESCE(MAX(number), 0) + 1 AS next FROM version WHERE artifact_id = ?",
              input.artifactId,
            )?.next ?? 1;
          db.run(
            "INSERT INTO version (id, artifact_id, number, source_digest, env_digest, output_digest, manifest_json, forced_codes_json, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            input.versionId,
            input.artifactId,
            number,
            input.sourceDigest,
            input.envDigest,
            input.outputDigest,
            JSON.stringify(input.manifest),
            input.forcedCodes.length > 0 ? JSON.stringify(input.forcedCodes) : null,
            now,
          );
        }
        if (cursor === undefined) {
          // A new version, or an earlier one published again: it becomes the latest (D09).
          cursor = appendEvent(db, {
            artifactId: input.artifactId,
            type: "version.published",
            payload: {
              versionId: input.versionId,
              number,
              forcedCodes: [...input.forcedCodes],
              ...(existing ? { republished: true } : {}),
            },
          });
        }
        const manifest = existing
          ? (JSON.parse(existing.manifest_json) as ArtifactManifest)
          : input.manifest;
        const policy = input.policy ?? manifest.submission;
        db.run(
          "UPDATE artifact SET title = ?, family = ?, links_json = ?, policy_json = ?, latest_version_id = ? WHERE id = ?",
          manifest.title,
          manifest.family ?? null,
          JSON.stringify(manifest.links ?? []),
          policy === undefined ? null : JSON.stringify(policy),
          input.versionId,
          input.artifactId,
        );
        db.run(
          "INSERT INTO source_binding (path, artifact_id, bound_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET artifact_id = excluded.artifact_id, bound_at = excluded.bound_at",
          input.bindingPath,
          input.artifactId,
          now,
        );
        const committed = { version: number, cursor, reused: existing !== undefined };
        if (input.requestId !== undefined) {
          const receipt = {
            artifactId: input.artifactId,
            versionId: input.versionId,
            ...committed,
            ...(input.forcedCodes.length > 0 ? { forcedDiagnostics: [...input.forcedCodes] } : {}),
          };
          db.run(
            "INSERT INTO request (method, request_id, result_json, created_at) VALUES ('artifact/publish', ?, ?, ?)",
            input.requestId,
            JSON.stringify(receipt),
            now,
          );
        }
        input.faults?.at("publish:in-commit");
        return committed;
      });
    },
    sourceOf(artifactId) {
      return ledger.read(
        (db) =>
          db.get<{ path: string }>(
            "SELECT path FROM source_binding WHERE artifact_id = ? ORDER BY bound_at DESC, path LIMIT 1",
            artifactId,
          )?.path,
      );
    },
    list(filter = {}) {
      return ledger.read((db) => {
        const rows = db.all<ArtifactRow & { published_at: string }>(
          `SELECT artifact.*, version.published_at FROM artifact
           JOIN version ON version.id = artifact.latest_version_id
           ${filter.family !== undefined ? "WHERE artifact.family = ?" : ""}
           ORDER BY version.published_at DESC, artifact.id`,
          ...(filter.family !== undefined ? [filter.family] : []),
        );
        return rows.map((row) => summary(db, row).summary);
      });
    },
    get(ref) {
      return ledger.read((db) => {
        const id =
          "artifactId" in ref ? ref.artifactId : (boundArtifact(db, ref.path) ?? undefined);
        const row =
          id === undefined
            ? undefined
            : db.get<ArtifactRow>("SELECT * FROM artifact WHERE id = ?", id);
        if (!row) {
          throw notFound(
            "artifactId" in ref
              ? `No artifact ${ref.artifactId} was published in this home.`
              : `No artifact was published from ${ref.path} in this home.`,
          );
        }
        const { summary: base, latest } = summary(db, row);
        const versions = db
          .all<VersionRow>(
            "SELECT * FROM version WHERE artifact_id = ? ORDER BY number DESC",
            row.id,
          )
          .map(versionSummary);
        return {
          ...base,
          manifest: latest
            ? (JSON.parse(latest.manifest_json) as ArtifactManifest)
            : { title: row.title },
          versions,
        };
      });
    },
    async recover() {
      const known = ledger.read((db) => ({
        versions: new Set(db.all<{ id: string }>("SELECT id FROM version").map((row) => row.id)),
        snapshots: new Set(
          db
            .all<{ artifact_id: string; source_digest: string }>(
              "SELECT artifact_id, source_digest FROM version",
            )
            .map((row) => `${row.artifact_id}/${row.source_digest}.tar.zst`),
        ),
      }));
      return store.sweep(known);
    },
  };
}
