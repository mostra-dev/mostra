/**
 * gc's reference rules (VR-06, D140 item 14): a schema walk that fails when a ledger column naming
 * a version has no reference source, and a property test that gc collects exactly the versions no
 * source keeps.
 */
import { createRequire } from "node:module";
import { VersionId } from "@mostra/protocol";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  collectableVersions,
  EXEMPT_COLUMNS,
  keptVersions,
  REFERENCE_SOURCES,
} from "../../src/gc/index.ts";
import { type LedgerDb, MIGRATIONS, type MigrationDb } from "../../src/ledger/index.ts";

const Database = createRequire(import.meta.url)(
  "better-sqlite3",
) as typeof import("better-sqlite3");

/** A migrated in-memory ledger, foreign keys off so a test inserts only the rows it means. */
function migrated(): { db: LedgerDb; raw: import("better-sqlite3").Database } {
  const raw = new Database(":memory:");
  raw.pragma("foreign_keys = OFF");
  const db: MigrationDb = {
    run: (sql, ...params) => raw.prepare(sql).run(...params),
    get: (sql, ...params) => raw.prepare(sql).get(...params) as never,
    all: (sql, ...params) => raw.prepare(sql).all(...params) as never,
    exec: (sql) => {
      raw.exec(sql);
    },
  };
  raw.exec(
    "CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY, name TEXT, runtime_version TEXT, applied_at TEXT)",
  );
  for (const migration of MIGRATIONS) migration.up(db);
  return { db, raw };
}

/** Tables a reference source covers before the package that creates them exists (WP-20). */
const FUTURE_TABLES = new Set(["thread"]);

describe("gc's reference sources (D140 item 14)", () => {
  it("cover or exempt every ledger column that names a version", () => {
    const { db } = migrated();
    const tables = db
      .all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .map((row) => row.name);
    const naming: string[] = [];
    for (const table of tables) {
      const references = new Set(
        db
          .all<{ table: string; from: string }>(`PRAGMA foreign_key_list(${table})`)
          .filter((key) => key.table === "version")
          .map((key) => key.from),
      );
      for (const { name } of db.all<{ name: string }>(`PRAGMA table_info(${table})`)) {
        if (references.has(name) || /version/i.test(name)) naming.push(`${table}.${name}`);
      }
    }
    // Every source's rows must say why it keeps a version; JSON texts that name version IDs are
    // covered by the sources that scan them.
    const covered = new Set([
      ...REFERENCE_SOURCES.flatMap((source) => source.covers),
      ...EXEMPT_COLUMNS.map((exempt) => exempt.column),
    ]);
    expect(naming.filter((column) => !covered.has(column))).toEqual([]);
    // And nothing is covered that doesn't exist (a renamed column would hide a gap).
    const existing = new Set(
      tables.flatMap((table) =>
        db
          .all<{ name: string }>(`PRAGMA table_info(${table})`)
          .map((column) => `${table}.${column.name}`),
      ),
    );
    expect(
      [...covered].filter(
        (column) => !existing.has(column) && !FUTURE_TABLES.has(column.split(".")[0] as string),
      ),
    ).toEqual([]);
    for (const exempt of EXEMPT_COLUMNS) expect(exempt.reason.length).toBeGreaterThan(0);
  });
});

/** Values the schema's CHECK constraints accept, for columns a test leaves out. */
const CHECKED: Readonly<Record<string, string | number>> = {
  channel: "shell",
  mode: "cookie",
  scope: "artifact",
  status: "succeeded",
  kind: "local",
  deleted: 0,
  field_rev: 1,
  log_truncated: 0,
  is_default: 0,
};

/** Inserts a row, filling NOT NULL columns the test doesn't care about. */
function insert(db: LedgerDb, table: string, values: Record<string, string | number | null>): void {
  let filler = 0;
  const row: Record<string, string | number | null> = {};
  for (const column of db.all<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
  }>(`PRAGMA table_info(${table})`)) {
    if (column.name in values) row[column.name] = values[column.name] ?? null;
    else if (column.name in CHECKED && column.notnull === 1)
      row[column.name] = CHECKED[column.name] as string | number;
    else if (column.notnull === 1 && column.dflt_value === null) {
      filler += 1;
      // 1 satisfies the schema's integer checks (flags, revisions, epochs); texts are unique.
      row[column.name] = /INT/i.test(column.type)
        ? 1
        : `x${Math.random().toString(36).slice(2)}${filler}`;
    }
  }
  const names = Object.keys(row);
  db.run(
    `INSERT INTO ${table} (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
    ...names.map((name) => row[name] ?? null),
  );
}

const NOW = "2026-10-18T12:00:00.000Z";

/** One way a version can be referenced (or look referenced and not be). */
type Reference =
  | "view"
  | "submission"
  | "submission-latest"
  | "submission-snapshot"
  | "run"
  | "session"
  | "live"
  | "review-choice"
  | "field-version"
  | "pinned-link"
  | "revoked-link"
  | "expired-link";

const KEEPS: Readonly<Record<Reference, boolean>> = {
  view: true,
  submission: true,
  "submission-latest": true,
  "submission-snapshot": true,
  run: true,
  session: true,
  live: true,
  "review-choice": true,
  "field-version": true,
  "pinned-link": true,
  "revoked-link": false,
  "expired-link": false,
};

let seq = 0;
function addReference(
  db: LedgerDb,
  kind: Reference,
  artifactId: string,
  versionId: string,
  number: number,
): void {
  seq += 1;
  const id = `r${seq}`;
  switch (kind) {
    case "view":
      insert(db, "view", { id: `vw_${id}`, artifact_id: artifactId, version_id: versionId });
      return;
    case "submission":
      insert(db, "submission", {
        id: `sub_${id}`,
        artifact_id: artifactId,
        version_id: versionId,
        position: seq,
        latest_version_number: null,
        snapshot_json: "{}",
      });
      return;
    case "submission-latest":
      insert(db, "submission", {
        id: `sub_${id}`,
        artifact_id: artifactId,
        version_id: "ver_unrelated",
        position: seq,
        latest_version_number: number,
        snapshot_json: "{}",
      });
      return;
    case "submission-snapshot":
      insert(db, "submission", {
        id: `sub_${id}`,
        artifact_id: artifactId,
        version_id: "ver_unrelated",
        position: seq,
        latest_version_number: null,
        snapshot_json: JSON.stringify({ choice: versionId }),
      });
      return;
    case "run":
      insert(db, "action_run", {
        id: `run_${id}`,
        artifact_id: artifactId,
        version_id: versionId,
        status: "succeeded",
        log_truncated: 0,
        key: null,
      });
      return;
    case "session":
      insert(db, "session", { id: `s${id}`, mode: "cookie", version_id: versionId });
      return;
    case "live":
      insert(db, "live_value", {
        artifact_id: artifactId,
        key: `k${id}`,
        revision: 1,
        producer_version_id: versionId,
      });
      return;
    case "review-choice":
    case "field-version": {
      insert(db, "document", {
        id: seq,
        artifact_id: artifactId,
        // A draft per reference: one artifact-state document per artifact is the schema's rule.
        scope: "viewer",
        viewer_id: `vwr_${id}`,
        revision: 1,
      });
      insert(db, "field", {
        document_id: seq,
        field_id: kind === "review-choice" ? `review.set${id}.choice` : `answer${id}`,
        value_json:
          kind === "review-choice" ? JSON.stringify(versionId) : JSON.stringify(versionId),
        deleted: 0,
        field_rev: 1,
        version_number: kind === "field-version" ? number : null,
      });
      return;
    }
    case "pinned-link":
    case "revoked-link":
    case "expired-link":
      insert(db, "token", {
        id: `tok_${id}`,
        artifact_id: artifactId,
        pinned_version: number,
        is_default: 0,
        revoked_at: kind === "revoked-link" ? NOW : null,
        expires_at: kind === "expired-link" ? "2026-10-17T00:00:00.000Z" : null,
      });
      return;
  }
}

const REFERENCES = Object.keys(KEEPS) as Reference[];

describe("gc collects exactly what nothing references (VR-06)", () => {
  it("never a version a submission, view, run, session, live value, review set, field, live pinned link, baseline or follow names, and every other one but the latest", () => {
    fc.assert(
      fc.property(
        // Each artifact's versions, by their recorded verdict: none, pass or fail (D138 item 4).
        fc.array(fc.array(fc.constantFrom(null, "pass", "fail"), { minLength: 1, maxLength: 5 }), {
          minLength: 1,
          maxLength: 3,
        }),
        fc.array(
          fc.record({
            kind: fc.constantFrom(...REFERENCES),
            artifact: fc.nat(),
            version: fc.nat(),
          }),
          { maxLength: 12 },
        ),
        fc.array(fc.nat(), { maxLength: 2 }),
        (verdicts, references, follows) => {
          const { db, raw } = migrated();
          const artifacts = verdicts.map((statuses, index) => {
            const artifactId = `art_${String(index).padStart(26, "0")}`;
            const versions = statuses.map((_, n) => {
              const digest = new Uint8Array(32);
              digest[0] = index;
              digest[1] = n;
              return VersionId.fromSha256(digest);
            });
            insert(db, "artifact", {
              id: artifactId,
              latest_version_id: versions.at(-1) as string,
            });
            for (const [n, versionId] of versions.entries()) {
              insert(db, "version", {
                id: versionId,
                artifact_id: artifactId,
                number: n + 1,
                verify_json:
                  statuses[n] === null
                    ? null
                    : JSON.stringify({ status: statuses[n], verifyRevision: "1" }),
              });
            }
            return { artifactId, versions, statuses };
          });
          const expected = new Set(artifacts.map((artifact) => artifact.versions.at(-1) as string));
          for (const reference of references) {
            const artifact = artifacts[reference.artifact % artifacts.length];
            if (!artifact) continue;
            const index = reference.version % artifact.versions.length;
            const versionId = artifact.versions[index] as string;
            addReference(db, reference.kind, artifact.artifactId, versionId, index + 1);
            if (KEEPS[reference.kind]) expected.add(versionId);
          }
          // The regression baseline: each artifact's newest version whose verdict passed.
          for (const artifact of artifacts) {
            const newest = artifact.statuses.lastIndexOf("pass");
            if (newest >= 0) expected.add(artifact.versions[newest] as string);
          }
          for (const follow of follows) {
            const artifact = artifacts[follow % artifacts.length] as (typeof artifacts)[number];
            insert(db, "follow", { viewer_id: `vwr_${seq++}`, artifact_id: artifact.artifactId });
          }
          const all = artifacts.flatMap((artifact) => artifact.versions);
          const collectable = collectableVersions(db, NOW).map((version) => version.versionId);
          expect(new Set(collectable)).toEqual(new Set(all.filter((id) => !expected.has(id))));
          expect(collectable.some((id) => keptVersions(db, NOW).has(id))).toBe(false);
          raw.close();
        },
      ),
      { numRuns: 200 },
    );
  });

  it("keeps a followed artifact's latest version (LL-03), and a collected version is never offered twice", () => {
    const { db } = migrated();
    const versions = [1, 2].map((n) => {
      const digest = new Uint8Array(32);
      digest[0] = 200;
      digest[1] = n;
      return VersionId.fromSha256(digest);
    });
    insert(db, "artifact", { id: "art_FOLLOWED", latest_version_id: versions[1] as string });
    for (const [n, id] of versions.entries()) {
      insert(db, "version", { id, artifact_id: "art_FOLLOWED", number: n + 1, verify_json: null });
    }
    insert(db, "follow", { viewer_id: "vwr_1", artifact_id: "art_FOLLOWED" });
    const followed = REFERENCE_SOURCES.find((source) => source.name === "followed artifacts");
    expect([...(followed?.keep(db, NOW) ?? [])]).toEqual([versions[1]]);
    expect(collectableVersions(db, NOW).map((version) => version.versionId)).toEqual([versions[0]]);
    db.run(
      "INSERT INTO version_collected (version_id, collected_at) VALUES (?, ?)",
      versions[0] as string,
      NOW,
    );
    expect(collectableVersions(db, NOW)).toEqual([]);
    // The row stays forever; the collection record never changes.
    expect(() => db.run("DELETE FROM version WHERE id = ?", versions[0] as string)).toThrow(
      /kept forever/,
    );
    expect(() =>
      db.run(
        "UPDATE version_collected SET collected_at = ? WHERE version_id = ?",
        "x",
        versions[0] as string,
      ),
    ).toThrow(/never changes/);
  });
});
