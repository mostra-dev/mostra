/**
 * `mostra gc` (VR-06, D47, D140 item 14): removes what nothing references, on request only.
 *
 * - **Versions.** A version is kept while any {@link REFERENCE_SOURCES} names it. One nothing names
 *   loses its files; its ledger row, ID and number stay forever, and `version_collected` records
 *   the collection, so a content-addressed ID never gets a second number. Publishing its exact
 *   source again restores the files (publish's repair path) and clears the record.
 * - **Everything else** gc collects belongs to the module that owns it: lock layouts and the store
 *   (`deps`), verify's caches (`verify`), events (`interaction`'s compaction, only when asked).
 * - **Order.** A run holds the instance's gate alone, so no publish, verify or install runs beside
 *   it. It decides and records the collected versions in one transaction, then removes their files
 *   after the commit; when the process dies in between, recovery at start removes what the record
 *   says is gone. A real run lists exactly what a dry run lists.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  createDiagnostic,
  type Diagnostic,
  type GcCompacted,
  type GcRunParams,
  type GcRunResult,
  type GcVersion,
  gcRunMethod,
  RpcError,
} from "@mostra/protocol";
import type { Dependencies } from "../deps/index.ts";
import type { Faults } from "../faults.ts";
import type { Gate } from "../gate.ts";
import { compactEvents } from "../interaction/index.ts";
import type { Ledger, LedgerDb } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import { handler, type MethodHandler } from "../protocol-server/index.ts";
import { type Registry, removeTree } from "../registry/index.ts";

/** One reason a version is kept: a named source over the ledger columns it accounts for. */
export interface ReferenceSource {
  /** What references the version, in words: `submissions`, `pinned links` … */
  readonly name: string;
  /** The ledger columns it accounts for, as `table.column` (the schema test checks them). */
  readonly covers: readonly string[];
  /** The version IDs it keeps, read inside gc's transaction at `now` (RFC 3339). */
  keep(db: LedgerDb, now: string): Iterable<string>;
}

/** A ledger column that names a version but keeps none, with the reason. */
export interface ExemptColumn {
  readonly column: string;
  readonly reason: string;
}

/** Every version ID written in a text: snapshots, anchors and review choices name them (D89). */
const VERSION_IDS = /ver_[0-9A-HJKMNP-TV-Z]{26}/g;

function* idsIn(texts: Iterable<string | null>): Iterable<string> {
  for (const text of texts) if (text) yield* text.match(VERSION_IDS) ?? [];
}

const column = <T>(db: LedgerDb, sql: string, ...params: string[]): T[] =>
  db.all<{ value: T }>(sql, ...params).map((row) => row.value);

const tableExists = (db: LedgerDb, table: string): boolean =>
  db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", table) !== undefined;

/** The version a number names within its artifact: `SELECT id FROM version` joined by number. */
const BY_NUMBER = (alias: string, numberColumn: string): string =>
  `(SELECT version.id FROM version WHERE version.artifact_id = ${alias}.artifact_id AND version.number = ${alias}.${numberColumn})`;

/**
 * Why versions are kept, one named source each (D140 item 14). A table that names versions joins
 * this list, or {@link EXEMPT_COLUMNS} with a reason; the schema test fails until it does.
 */
export const REFERENCE_SOURCES: readonly ReferenceSource[] = [
  {
    name: "latest versions",
    covers: ["artifact.latest_version_id"],
    keep: (db) =>
      column<string>(
        db,
        "SELECT latest_version_id AS value FROM artifact WHERE latest_version_id IS NOT NULL",
      ),
  },
  {
    // Following loads each new latest version (D63, LL-03): the latest is kept above, and this
    // source says so, so a change to either rule shows in its test.
    name: "followed artifacts",
    covers: [],
    keep: (db) =>
      column<string>(
        db,
        "SELECT artifact.latest_version_id AS value FROM follow JOIN artifact ON artifact.id = follow.artifact_id WHERE artifact.latest_version_id IS NOT NULL",
      ),
  },
  {
    name: "submissions",
    covers: [
      "submission.version_id",
      "submission.latest_version_number",
      "submission.snapshot_json",
    ],
    keep: function* (db) {
      yield* column<string>(db, "SELECT version_id AS value FROM submission");
      yield* column<string>(
        db,
        `SELECT ${BY_NUMBER("submission", "latest_version_number")} AS value FROM submission WHERE latest_version_number IS NOT NULL`,
      ).filter((id) => id !== null);
      yield* idsIn(column<string>(db, "SELECT snapshot_json AS value FROM submission"));
    },
  },
  {
    name: "views",
    covers: ["view.version_id"],
    keep: (db) => column<string>(db, "SELECT version_id AS value FROM view"),
  },
  {
    name: "comment threads",
    covers: ["thread.version_id", "thread.anchor_json"],
    keep: function* (db) {
      if (!tableExists(db, "thread")) return;
      yield* column<string>(db, "SELECT version_id AS value FROM thread");
      yield* idsIn(column<string>(db, "SELECT anchor_json AS value FROM thread"));
    },
  },
  {
    name: "action runs",
    covers: ["action_run.version_id"],
    keep: (db) => column<string>(db, "SELECT version_id AS value FROM action_run"),
  },
  {
    name: "live sessions",
    covers: ["session.version_id"],
    keep: (db) =>
      column<string>(db, "SELECT version_id AS value FROM session WHERE version_id IS NOT NULL"),
  },
  {
    name: "live producer values",
    covers: ["live_value.producer_version_id"],
    keep: (db) =>
      column<string>(
        db,
        "SELECT producer_version_id AS value FROM live_value WHERE producer_version_id IS NOT NULL",
      ),
  },
  {
    // A review set's candidates may be versions (D23); a choice, a draft's or the artifact
    // state's, names the one chosen. The version whose view last wrote a field is its orphan's
    // `fromVersion` (D109).
    name: "review sets and fields",
    covers: ["field.value_json", "field.version_number"],
    keep: function* (db) {
      yield* idsIn(
        column<string>(db, "SELECT value_json AS value FROM field WHERE field_id LIKE 'review.%'"),
      );
      yield* column<string>(
        db,
        `SELECT (SELECT version.id FROM version WHERE version.artifact_id = document.artifact_id AND version.number = field.version_number) AS value FROM field JOIN document ON document.id = field.document_id WHERE field.version_number IS NOT NULL`,
      ).filter((id) => id !== null);
    },
  },
  {
    name: "pinned links",
    covers: ["token.pinned_version"],
    keep: (db, now) =>
      column<string>(
        db,
        `SELECT ${BY_NUMBER("token", "pinned_version")} AS value FROM token WHERE pinned_version IS NOT NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
        now,
      ).filter((id) => id !== null),
  },
  {
    // The regression baseline (D138 item 4): the newest version whose recorded verdict passed.
    name: "regression baselines",
    covers: ["version.verify_json"],
    keep: (db) =>
      column<string>(
        db,
        "SELECT (SELECT id FROM version AS newest WHERE newest.artifact_id = artifact.id AND json_extract(newest.verify_json, '$.status') = 'pass' ORDER BY newest.number DESC LIMIT 1) AS value FROM artifact",
      ).filter((id) => id !== null),
  },
];

/** Columns that name versions but keep none. */
export const EXEMPT_COLUMNS: readonly ExemptColumn[] = [
  { column: "version.id", reason: "the version itself" },
  { column: "version.number", reason: "the version itself" },
  {
    column: "version_collected.version_id",
    reason: "the record that gc collected the version",
  },
  {
    column: "schema_migration.version",
    reason: "the ledger's schema version, not an artifact version",
  },
  {
    column: "dependency_package.version",
    reason: "an npm package's version in the store index, not an artifact version",
  },
  {
    column: "schema_migration.runtime_version",
    reason: "the runtime release that ran a migration",
  },
];

/** The versions some source keeps. */
export function keptVersions(db: LedgerDb, now: string): Set<string> {
  const kept = new Set<string>();
  for (const source of REFERENCE_SOURCES) for (const id of source.keep(db, now)) kept.add(id);
  return kept;
}

/** A version gc would collect: not collected yet, and kept by no source. */
export interface Candidate {
  readonly artifactId: string;
  readonly versionId: string;
  readonly number: number;
  readonly sourceDigest: string;
}

/** The versions gc collects now: not collected yet, and kept by no {@link REFERENCE_SOURCES}. */
export function collectableVersions(db: LedgerDb, now: string): Candidate[] {
  const kept = keptVersions(db, now);
  return db
    .all<{ id: string; artifact_id: string; number: number; source_digest: string }>(
      "SELECT id, artifact_id, number, source_digest FROM version WHERE id NOT IN (SELECT version_id FROM version_collected) ORDER BY artifact_id, number",
    )
    .filter((row) => !kept.has(row.id))
    .map((row) => ({
      artifactId: row.artifact_id,
      versionId: row.id,
      number: row.number,
      sourceDigest: row.source_digest,
    }));
}

/** What gc needs of its instance. */
export interface GcOptions {
  readonly ledger: Ledger;
  readonly registry: Registry;
  readonly log: Log;
  /** The instance's gate: gc holds it alone. */
  readonly gate: Gate;
  readonly dependencies: () => Dependencies;
  /** Verify's caches past their cap; absent while verify was never used. */
  readonly caches: (dryRun: boolean) => Promise<{ readonly count: number; readonly bytes: number }>;
  /** The clock (tests move it); default `Date.now`. */
  readonly now?: () => number;
  /** Test fault points: `gc:dependencies` fails the dependency step. */
  readonly faults?: Faults;
}

/** The home's garbage collector. */
export interface Gc {
  /** `gc/run`: collects, or with `dryRun` lists, what nothing references. */
  run(params: GcRunParams): Promise<GcRunResult>;
}

/** Creates the garbage collector of one instance. */
export function createGc(options: GcOptions): Gc {
  const { ledger, registry, log } = options;
  const now = options.now ?? Date.now;

  /** The bytes a directory or file holds; 0 when it is gone. */
  const sizeOf = async (path: string): Promise<number> => {
    const info = await stat(path).catch(() => undefined);
    if (!info) return 0;
    if (!info.isDirectory()) return info.size;
    let total = 0;
    for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      total += await sizeOf(join(path, entry.name));
    }
    return total;
  };

  return {
    run: (params) =>
      options.gate.exclusive(async () => {
        const dryRun = params.dryRun === true;
        const at = new Date(now()).toISOString();
        // 1. Decide, and for a real run record, in one transaction.
        const chosen = ledger.write((db) => {
          const found = collectableVersions(db, at);
          if (!dryRun) {
            for (const candidate of found) {
              db.run(
                "INSERT INTO version_collected (version_id, collected_at) VALUES (?, ?)",
                candidate.versionId,
                at,
              );
            }
          }
          return found;
        });
        // Source snapshots, and lockfiles, of the versions that keep their files.
        const chosenIds = new Set(chosen.map((candidate) => candidate.versionId));
        const keptRows = ledger
          .read((db) =>
            db.all<{ id: string; artifact_id: string; source_digest: string }>(
              "SELECT id, artifact_id, source_digest FROM version WHERE id NOT IN (SELECT version_id FROM version_collected)",
            ),
          )
          .filter((row) => !chosenIds.has(row.id));
        const keptSnapshots = new Set(
          keptRows.map((row) => `${row.artifact_id}/${row.source_digest}`),
        );
        const snapshots = [
          ...new Set(
            chosen
              .map((candidate) => `${candidate.artifactId}/${candidate.sourceDigest}`)
              .filter((key) => !keptSnapshots.has(key)),
          ),
        ];
        // A step that fails leaves its files and becomes a warning; what earlier steps removed
        // is still reported (Opus review finding 1). The tombstones are committed: recovery at
        // start removes any version file a failed removal left.
        const warnings: Diagnostic[] = [];
        const incomplete = (step: string, error: unknown): void => {
          const cause =
            error instanceof RpcError
              ? `${error.diagnostic.code}: ${error.diagnostic.message}`
              : error instanceof Error
                ? error.message
                : String(error);
          warnings.push(
            createDiagnostic("MOSTRA_HOME_GC_INCOMPLETE", {
              message: `gc couldn't finish ${step}: ${cause}`,
            }),
          );
          log.warn("gc.incomplete", { step, cause });
        };
        // 2. Sizes, then the files: after the commit, so a crash leaves only what recovery removes.
        const versions: GcVersion[] = [];
        for (const candidate of chosen) {
          const dir = registry.store.versionDir(candidate.versionId);
          versions.push({
            artifactId: candidate.artifactId,
            versionId: candidate.versionId,
            number: candidate.number,
            bytes: await sizeOf(dir),
          });
          if (!dryRun)
            await removeTree(dir).catch((error: unknown) =>
              incomplete(`removing ${candidate.versionId}'s files`, error),
            );
        }
        let snapshotBytes = 0;
        for (const key of snapshots) {
          const [artifactId, sourceDigest] = key.split("/") as [string, string];
          const path = registry.store.snapshotPath(artifactId, sourceDigest);
          snapshotBytes += await sizeOf(path);
          if (!dryRun)
            await removeTree(path).catch((error: unknown) =>
              incomplete("removing a source snapshot", error),
            );
        }
        // 3. Lock layouts and the store: what the versions that keep their files still need.
        const keep: string[] = [];
        for (const row of keptRows) {
          const text = await readFile(
            join(registry.store.versionDir(row.id), "lock.yaml"),
            "utf8",
          ).catch(() => undefined);
          if (text !== undefined) keep.push(text);
        }
        const none = { count: 0, bytes: 0 };
        const deps = await Promise.resolve()
          .then(() => {
            options.faults?.at("gc:dependencies");
            return options.dependencies().collect({ keep, dryRun });
          })
          .catch((error: unknown) => {
            incomplete("collecting lock layouts and the package store", error);
            return {
              lockLayouts: { ...none, names: [] as string[] },
              storePackages: { ...none, packages: [] as string[] },
            };
          });
        if ("failed" in deps.storePackages && deps.storePackages.failed)
          incomplete("pruning the package store", new RpcError(deps.storePackages.failed));
        // 4. Verify's caches.
        const caches = await options.caches(dryRun).catch((error: unknown) => {
          incomplete("collecting verify's caches", error);
          return none;
        });
        // 5. Events, only when asked (D47).
        let compacted: GcCompacted | undefined;
        if (params.compactEvents !== undefined) {
          const before = Number(params.compactEvents.before);
          const pending = (db: LedgerDb, artifactId: string): number =>
            db.get<{ n: number }>(
              "SELECT COUNT(*) AS n FROM event WHERE artifact_id = ? AND cursor < ? AND type <> 'artifact.compacted'",
              artifactId,
              before,
            )?.n ?? 0;
          const compact = (db: LedgerDb): GcCompacted => {
            const done: { artifactId: string; removed: number }[] = [];
            for (const { artifact_id: artifactId } of db.all<{ artifact_id: string }>(
              "SELECT DISTINCT artifact_id FROM event WHERE cursor < ? AND artifact_id IS NOT NULL ORDER BY artifact_id",
              before,
            )) {
              const removed = pending(db, artifactId);
              if (removed === 0) continue;
              if (!dryRun) compactEvents(db, artifactId, before);
              done.push({ artifactId, removed });
            }
            return { artifacts: done, removed: done.reduce((acc, item) => acc + item.removed, 0) };
          };
          try {
            compacted = dryRun ? ledger.read(compact) : ledger.write(compact);
          } catch (error) {
            incomplete("compacting events", error);
          }
        }
        const result: GcRunResult = {
          dryRun,
          versions,
          snapshots: { count: snapshots.length, bytes: snapshotBytes },
          lockLayouts: { count: deps.lockLayouts.count, bytes: deps.lockLayouts.bytes },
          storePackages: { count: deps.storePackages.count, bytes: deps.storePackages.bytes },
          caches,
          bytes:
            versions.reduce((acc, version) => acc + version.bytes, 0) +
            snapshotBytes +
            deps.lockLayouts.bytes +
            deps.storePackages.bytes +
            caches.bytes,
          ...(compacted ? { compacted } : {}),
          ...(warnings.length > 0 ? { warnings } : {}),
        };
        log.info(dryRun ? "gc.planned" : "gc.collected", {
          versions: versions.length,
          snapshots: snapshots.length,
          lockLayouts: deps.lockLayouts.count,
          storePackages: deps.storePackages.count,
          caches: caches.count,
          bytes: result.bytes,
          ...(compacted ? { compactedEvents: compacted.removed } : {}),
        });
        return result;
      }),
  };
}

/** The handler of `gc/run`. */
export function gcMethods(gc: Gc): MethodHandler[] {
  return [handler(gcRunMethod, (params) => gc.run(params))];
}
