import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { RpcError } from "@mostra/protocol";
import { describe, expect, it } from "vitest";
import {
  LEDGER_FILE,
  type Ledger,
  MIGRATIONS,
  type Migration,
  openLedger,
} from "../../src/ledger/index.ts";
import { silentLog } from "../../src/log.ts";
import { tempDir } from "../support.ts";

const Database = createRequire(import.meta.url)(
  "better-sqlite3",
) as typeof import("better-sqlite3");
const owner = { pid: process.pid, startTime: "boot/1" };
const storeDir = (): string => join(tempDir("mostra-ledger"), "store");

function open(dir: string, migrations?: readonly Migration[], runtimeVersion = "1.0.0"): Ledger {
  const opening = openLedger({
    storeDir: dir,
    runtimeVersion,
    owner,
    log: silentLog,
    ...(migrations ? { migrations } : {}),
  });
  if (!opening.ok) throw new Error("locked");
  return opening.ledger;
}

function failure(fn: () => unknown): RpcError {
  try {
    fn();
  } catch (error) {
    if (error instanceof RpcError) return error;
    throw error;
  }
  throw new Error("expected a failure");
}

/** The runtime's latest schema version, and the one a test migration adds after it. */
const LATEST = MIGRATIONS.at(-1)?.version ?? 0;
const NEXT = LATEST + 1;

const notes: Migration = {
  version: NEXT,
  name: "notes",
  up: (db) => db.exec("CREATE TABLE note (id INTEGER PRIMARY KEY, text TEXT NOT NULL)"),
};

describe("opening the ledger (D71, D81)", () => {
  it("creates a WAL ledger with synchronous=FULL at the latest schema", () => {
    const dir = storeDir();
    const ledger = open(dir);
    expect(ledger.schemaVersion).toBe(MIGRATIONS.at(-1)?.version);
    expect(ledger.migrated).toEqual({ from: 0, to: MIGRATIONS.at(-1)?.version });
    const versions = ledger.read((db) =>
      db.all<{ version: number }>("SELECT version FROM schema_migration"),
    );
    expect(versions.map((row) => row.version)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(ledger.read((db) => db.get<{ pid: number }>("SELECT pid FROM ledger_lock"))?.pid).toBe(
      process.pid,
    );
    expect(
      ledger.read((db) => db.get<{ journal_mode: string }>("PRAGMA journal_mode"))?.journal_mode,
    ).toBe("wal");
    expect(
      ledger.read((db) => db.get<{ synchronous: number }>("PRAGMA synchronous"))?.synchronous,
    ).toBe(2);
    expect(ledger.checkIntegrity()).toEqual({ ok: true, problems: [] });
    ledger.close();
    // Reopening applies nothing and takes no backup.
    const again = open(dir);
    expect(again.migrated).toBeUndefined();
    again.close();
    expect(readdirSync(dir).filter((name) => name.includes(".bak-"))).toEqual([]);
  });

  it("holds an exclusive lock another process can't take, released when the ledger closes", () => {
    const dir = storeDir();
    const ledger = open(dir);
    const probe = (): string =>
      spawnSync(
        process.execPath,
        [
          "-e",
          `const D=require(${JSON.stringify(createRequire(import.meta.url).resolve("better-sqlite3"))});` +
            `try{const d=new D(process.argv[1],{timeout:0});d.prepare("SELECT count(*) FROM schema_migration").get();console.log("read")}catch(e){console.log(e.code)}`,
          join(dir, LEDGER_FILE),
        ],
        { encoding: "utf8" },
      ).stdout.trim();
    expect(probe()).toBe("SQLITE_BUSY");
    ledger.close();
    expect(probe()).toBe("read");
  });

  it("removes half-built ledger files of dead starters and keeps those of live ones (racing starters)", () => {
    const dir = storeDir();
    mkdirSync(dir, { recursive: true });
    const dead = spawnSync(process.execPath, ["-e", "console.log(process.pid)"], {
      encoding: "utf8",
    });
    const deadPid = Number(dead.stdout.trim());
    const mine = `${LEDGER_FILE}.${process.pid}.1.creating`;
    const abandoned = `${LEDGER_FILE}.${deadPid}.1.creating`;
    writeFileSync(join(dir, mine), "");
    writeFileSync(join(dir, abandoned), "");
    writeFileSync(join(dir, `${abandoned}-wal`), "");
    open(dir).close();
    expect(
      readdirSync(dir)
        .filter((name) => name.endsWith(".creating") || name.endsWith("-wal"))
        .sort(),
    ).toEqual([mine]);
  });

  it("reports locked to a second opener in the same process", () => {
    const dir = storeDir();
    const ledger = open(dir);
    expect(openLedger({ storeDir: dir, runtimeVersion: "1", owner, log: silentLog })).toEqual({
      ok: false,
      reason: "locked",
    });
    ledger.close();
  });
});

describe("migrations (DATA_MODEL §6)", () => {
  it("backs up the ledger before migrating forward, in one transaction", () => {
    const dir = storeDir();
    const v1 = open(dir, MIGRATIONS, "1.0.0");
    v1.write((db) => db.run("INSERT INTO child VALUES (1, 'b/1', 'demo', 'x', 1, 'now', NULL)"));
    v1.close();

    const v2 = open(dir, [...MIGRATIONS, notes], "1.1.0");
    const backup = join(dir, `${LEDGER_FILE}.bak-${LATEST}-${NEXT}`);
    expect(v2.migrated).toEqual({ from: LATEST, to: NEXT, backup });
    expect(
      v2.read((db) => db.all("SELECT name FROM sqlite_master WHERE name = 'note'")),
    ).toHaveLength(1);
    expect(v2.read((db) => db.get<{ n: number }>("SELECT count(*) n FROM child"))?.n).toBe(1);
    expect(
      v2.read((db) =>
        db.get<{ runtime_version: string }>(
          "SELECT runtime_version FROM schema_migration WHERE version = ?",
          NEXT,
        ),
      ),
    ).toEqual({ runtime_version: "1.1.0" });
    v2.close();

    // The backup is the previous ledger, with its data and without the new table.
    const copy = new Database(backup, { readonly: true });
    expect(copy.prepare("SELECT max(version) v FROM schema_migration").get()).toEqual({
      v: LATEST,
    });
    expect(copy.prepare("SELECT count(*) n FROM child").get()).toEqual({ n: 1 });
    expect(copy.prepare("SELECT count(*) n FROM sqlite_master WHERE name = 'note'").get()).toEqual({
      n: 0,
    });
    copy.close();
  });

  it("rolls a failing migration back completely and keeps the backup", () => {
    const dir = storeDir();
    open(dir).close();
    const broken: Migration = {
      version: NEXT,
      name: "broken",
      up: (db) => {
        db.exec("CREATE TABLE half (x)");
        throw new Error("migration failed half-way");
      },
    };
    expect(() => open(dir, [...MIGRATIONS, broken])).toThrow("migration failed half-way");
    const ledger = open(dir);
    expect(
      ledger.read((db) => db.get<{ v: number }>("SELECT max(version) v FROM schema_migration"))?.v,
    ).toBe(LATEST);
    expect(
      ledger.read((db) => db.all("SELECT name FROM sqlite_master WHERE name = 'half'")),
    ).toEqual([]);
    ledger.close();
    expect(existsSync(join(dir, `${LEDGER_FILE}.bak-${LATEST}-${NEXT}`))).toBe(true);
  });

  it("refuses a ledger newer than the runtime with MOSTRA_HOME_TOO_NEW, naming both versions", () => {
    const dir = storeDir();
    open(dir, [...MIGRATIONS, notes], "2.0.0").close();
    const error = failure(() => open(dir, MIGRATIONS, "1.0.0"));
    expect(error.diagnostic.code).toBe("MOSTRA_HOME_TOO_NEW");
    expect(error.diagnostic.message).toContain(`schema version ${NEXT}`);
    expect(error.diagnostic.message).toContain("Mostra 2.0.0");
    expect(error.diagnostic.message).toContain("1.0.0");
    // Refusing leaves the ledger as it was.
    const reopened = open(dir, [...MIGRATIONS, notes], "2.0.0");
    expect(reopened.migrated).toBeUndefined();
    reopened.close();
  });
});

describe("unreadable ledgers (FAILURE_MODEL §3)", () => {
  it("refuses a file that isn't SQLite, and never replaces it", () => {
    const dir = storeDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, LEDGER_FILE), "not a database, but somebody's data".repeat(200));
    expect(failure(() => open(dir)).diagnostic.code).toBe("MOSTRA_HOME_LEDGER_UNREADABLE");
    expect(readdirSync(dir)).toEqual([LEDGER_FILE]);
  });

  it("refuses a SQLite database that isn't a Mostra ledger", () => {
    const dir = storeDir();
    mkdirSync(dir, { recursive: true });
    const other = new Database(join(dir, LEDGER_FILE));
    other.exec("CREATE TABLE something_else (x)");
    other.close();
    const error = failure(() => open(dir));
    expect(error.diagnostic.code).toBe("MOSTRA_HOME_LEDGER_UNREADABLE");
    expect(error.diagnostic.message).toContain("isn't a Mostra ledger");
  });
});

describe("writes (FAILURE_MODEL §1, §3)", () => {
  it("turns a full disk into MOSTRA_HOME_DISK_FULL and commits nothing", () => {
    const dir = storeDir();
    const ledger = open(dir);
    const pages =
      ledger.read((db) => db.get<{ page_count: number }>("PRAGMA page_count"))?.page_count ?? 0;
    ledger.read((db) => db.get(`PRAGMA max_page_count = ${pages}`));
    const error = failure(() =>
      ledger.write((db) => {
        db.run("INSERT INTO child VALUES (1, 'b/1', 'demo', 'x', 1, 'now', NULL)");
        db.run("INSERT INTO child VALUES (2, ?, 'demo', 'x', 2, 'now', NULL)", "z".repeat(200_000));
      }),
    );
    expect(error.diagnostic.code).toBe("MOSTRA_HOME_DISK_FULL");
    expect(ledger.read((db) => db.get<{ n: number }>("SELECT count(*) n FROM child"))?.n).toBe(0);
    ledger.close();
  });

  it("fails closed with MOSTRA_HOME_GONE when the ledger file is removed while open", () => {
    const dir = storeDir();
    const ledger = open(dir);
    rmSync(join(dir, LEDGER_FILE));
    rmSync(join(dir, `${LEDGER_FILE}-wal`), { force: true });
    const error = failure(() =>
      ledger.write((db) =>
        db.run("INSERT INTO child VALUES (1, 'b/1', 'demo', 'x', 1, 'now', NULL)"),
      ),
    );
    expect(error.diagnostic.code).toBe("MOSTRA_HOME_GONE");
    ledger.close();
  });
});

describe("write-once rows (invariant 3, IN-08)", () => {
  it("refuses to change a published version or an event, and keeps them as they were", () => {
    const ledger = open(storeDir());
    ledger.write((db) => {
      db.run(
        "INSERT INTO artifact (id, title, family, links_json, policy_json, created_at, latest_version_id) VALUES ('art_1', 'A', NULL, '[]', NULL, 'now', NULL)",
      );
      db.run(
        "INSERT INTO version VALUES ('ver_1', 'art_1', 1, 's', 'e', 'o', '{\"title\":\"A\"}', NULL, 'now')",
      );
      db.run(
        "INSERT INTO event (artifact_id, seq, type, actor_json, payload_json, at) VALUES ('art_1', 1, 'version.published', '{}', '{}', 'now')",
      );
    });
    expect(() =>
      ledger.write((db) =>
        db.run("UPDATE version SET source_digest = 'changed' WHERE id = 'ver_1'"),
      ),
    ).toThrow("published versions are immutable");
    expect(() =>
      ledger.write((db) => db.run("UPDATE event SET type = 'changed' WHERE seq = 1")),
    ).toThrow("events are append-only");
    expect(
      ledger.read((db) => db.get<{ source_digest: string }>("SELECT source_digest FROM version")),
    ).toEqual({ source_digest: "s" });
    ledger.close();
  });
});
