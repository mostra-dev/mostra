/**
 * The ledger (D58, D71, D81; DATA_MODEL §3, §6): the home's one SQLite database, in WAL mode with
 * `synchronous=FULL`, opened with an exclusive lock that decides who owns the home. The
 * supervisor is its only reader and writer; every other module reaches it through
 * {@link Ledger.write} and {@link Ledger.read}, and nothing else in the process opens the file
 * (POSIX drops a process's locks on a file when any descriptor for it closes).
 *
 * ```ts
 * const opened = openLedger({ storeDir, runtimeVersion, owner, log });
 * if (!opened.ok) return attachToOwner();          // another supervisor holds the lock
 * opened.ledger.write((db) => db.run("INSERT INTO child …", …));
 * ```
 */
import { existsSync, linkSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import type BetterSqlite3 from "better-sqlite3";
import type { Log } from "../log.ts";
import { fsyncPath } from "../platform/index.ts";
import { BOOTSTRAP_SQL, MIGRATIONS, type Migration } from "./migrations.ts";
import type { LedgerDb, MigrationDb, RunResult, SqlValue } from "./types.ts";

export { MIGRATIONS, type Migration } from "./migrations.ts";
export {
  InflightRequests,
  type RequestKey,
  recordedResult,
  recordResult,
  requestKey,
} from "./requests.ts";
export type { LedgerDb } from "./types.ts";

/** The ledger's file name inside `<home>/store`. */
export const LEDGER_FILE = "ledger.sqlite";

/** The process that holds the ledger's lock. */
export interface LedgerOwner {
  readonly pid: number;
  /** Its start time (processes/identity.ts). */
  readonly startTime: string;
}

/** Options for {@link openLedger}. */
export interface OpenLedgerOptions {
  /** `<home>/store`, created with mode 0700 when missing. */
  readonly storeDir: string;
  /** This runtime's release, recorded with each migration and named by `MOSTRA_HOME_TOO_NEW`. */
  readonly runtimeVersion: string;
  /** Who takes the lock, recorded in `ledger_lock`. */
  readonly owner: LedgerOwner;
  readonly log: Log;
  /** The migrations to apply. Default: this runtime's {@link MIGRATIONS}. */
  readonly migrations?: readonly Migration[];
  /**
   * `exclusive` (the default) holds SQLite's exclusive lock for as long as the ledger is open:
   * the lock decides who owns a local home (D81). `normal` is a hosted home's (D165 item 0b): the
   * one writer is whoever holds the home's own lock ({@link holdLock}), and a backup replicator
   * may read the ledger from its own process.
   */
  readonly locking?: "exclusive" | "normal";
  /** SQLite's `wal_autocheckpoint` for a `normal` ledger (a replicator may ask for 0). */
  readonly walAutocheckpoint?: number;
  /** The file's name in `storeDir`. Default: `ledger.sqlite`; a server's directory: `server.sqlite`. */
  readonly fileName?: string;
}

/** The open ledger. Holding this object holds the home's lock. */
export interface Ledger {
  /** The ledger file. */
  readonly file: string;
  /** The schema version after migrations. */
  readonly schemaVersion: number;
  /** The migrations applied while opening, with the backup taken first (when any). */
  readonly migrated:
    | { readonly from: number; readonly to: number; readonly backup?: string }
    | undefined;
  /**
   * Runs `fn` in one write transaction (`BEGIN IMMEDIATE`) and commits it, durably
   * (`synchronous=FULL`), before returning (FAILURE_MODEL §1 rule 1). A full disk throws
   * `MOSTRA_HOME_DISK_FULL`; a removed ledger throws `MOSTRA_HOME_GONE`. Nothing partial commits.
   */
  write<T>(fn: (db: LedgerDb) => T): T;
  /** Runs `fn` in one read transaction, so it sees a single consistent state. */
  read<T>(fn: (db: LedgerDb) => T): T;
  /**
   * Calls `listener` after every write transaction that committed, so readers waiting for new
   * events (`wait`, subscriptions, event streams) look again. Returns the unsubscribe function.
   * A listener's exception is swallowed: it never undoes or fails the commit.
   */
  onCommit(listener: () => void): () => void;
  /** Runs SQLite's full integrity check: `ok`, or the problems it reports. */
  checkIntegrity(): { readonly ok: boolean; readonly problems: readonly string[] };
  /** Closes the ledger and releases the home's lock. Idempotent. */
  close(): void;
}

/** The outcome of {@link openLedger}. */
export type LedgerOpening =
  | { readonly ok: true; readonly ledger: Ledger }
  | { readonly ok: false; readonly reason: "locked" };

type Database = BetterSqlite3.Database;
type DatabaseConstructor = typeof BetterSqlite3;

let driver: DatabaseConstructor | undefined;
/** Loads the native driver on first use, so importing this module loads no native code. */
function loadDriver(): DatabaseConstructor {
  driver ??= createRequire(import.meta.url)("better-sqlite3") as DatabaseConstructor;
  return driver;
}

const sqliteCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;

/**
 * Turns a SQLite failure into the diagnostic the caller can act on, or `undefined` for failures
 * that are defects (they stay internal errors).
 */
function diagnose(error: unknown, file: string): RpcError | undefined {
  const code = sqliteCode(error);
  if (code === undefined) return undefined;
  if (code === "SQLITE_FULL") {
    return new RpcError(
      createDiagnostic("MOSTRA_HOME_DISK_FULL", {
        message: `The disk holding ${file} is full; the change was rolled back.`,
      }),
    );
  }
  if (code === "SQLITE_READONLY_DBMOVED") {
    return new RpcError(
      createDiagnostic("MOSTRA_HOME_GONE", {
        message: `The ledger ${file} was moved or deleted while the instance was running.`,
      }),
    );
  }
  if (code === "SQLITE_NOTADB" || code.startsWith("SQLITE_CORRUPT") || code === "SQLITE_CANTOPEN") {
    return unreadable(file, describe(code));
  }
  return undefined;
}

function describe(code: string): string {
  if (code === "SQLITE_NOTADB") return "it isn't a SQLite database";
  if (code === "SQLITE_CANTOPEN") return "it can't be opened";
  return "it is damaged";
}

function unreadable(file: string, why: string): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_HOME_LEDGER_UNREADABLE", {
      message: `The ledger ${file} can't be read: ${why}.`,
    }),
  );
}

/** Builds a new ledger file at `file` without ever replacing an existing one (DATA_MODEL §6). */
function createLedgerFile(storeDir: string, file: string, log: Log, fileName = LEDGER_FILE): void {
  const Driver = loadDriver();
  const temp = join(storeDir, `${fileName}.${process.pid}.${Date.now()}.creating`);
  const db = new Driver(temp);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    db.exec(BOOTSTRAP_SQL);
  } finally {
    db.close();
  }
  fsyncPath(temp);
  try {
    linkSync(temp, file);
    log.info("ledger.created", { file });
  } catch (error) {
    // Another starter created it first; theirs is the ledger.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    rmSync(temp, { force: true });
  }
  syncDirectory(storeDir);
}

function syncDirectory(dir: string): void {
  // Some file systems can't fsync a directory; the data itself is synced.
  fsyncPath(dir, true);
}

/**
 * Removes `*.creating` files left by starters that died while building a ledger. A file whose
 * creator still runs is another starter's work in progress and stays.
 */
function removeAbandonedFiles(storeDir: string): void {
  for (const name of readdirSync(storeDir)) {
    const match = /^(?:ledger|server)\.sqlite\.(\d+)\.\d+\.creating(-wal|-shm|-journal)?$/.exec(
      name,
    );
    if (match && !processExists(Number(match[1]))) rmSync(join(storeDir, name), { force: true });
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** A migration's queries over a connection; exported for the schema tests, which migrate in memory. */
export function queries(db: Database): MigrationDb {
  const cache = new Map<string, BetterSqlite3.Statement>();
  const prepare = (sql: string): BetterSqlite3.Statement => {
    let statement = cache.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      cache.set(sql, statement);
    }
    return statement;
  };
  return {
    run(sql: string, ...params: readonly SqlValue[]): RunResult {
      const result = prepare(sql).run(...params);
      return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    },
    get<T>(sql: string, ...params: readonly SqlValue[]): T | undefined {
      return prepare(sql).get(...params) as T | undefined;
    },
    all<T>(sql: string, ...params: readonly SqlValue[]): T[] {
      return prepare(sql).all(...params) as T[];
    },
    exec(sql: string): void {
      db.exec(sql);
    },
    widenCheck(table: string, from: string, to: string): void {
      const row = db
        .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
        .get(table) as { sql: string } | undefined;
      if (!row || row.sql.split(from).length !== 2) {
        throw new Error(`widenCheck: ${table}'s definition doesn't hold ${from} exactly once.`);
      }
      const version = db.pragma("schema_version", { simple: true }) as number;
      db.unsafeMode(true);
      try {
        db.pragma("writable_schema = ON");
        db.prepare("UPDATE sqlite_schema SET sql = ? WHERE type = 'table' AND name = ?").run(
          row.sql.replace(from, to),
          table,
        );
        db.pragma(`schema_version = ${version + 1}`);
      } finally {
        db.pragma("writable_schema = OFF");
        db.unsafeMode(false);
      }
      const problems = db.pragma("integrity_check", { simple: true });
      if (problems !== "ok") throw new Error(`widenCheck: ${table}: ${String(problems)}`);
    },
  };
}

/**
 * Opens the home's ledger and takes its exclusive lock (D81). Returns `{ ok: false, reason:
 * "locked" }` when another process holds it. Throws an `RpcError` with `MOSTRA_HOME_TOO_NEW`,
 * `MOSTRA_HOME_LEDGER_UNREADABLE` or `MOSTRA_HOME_DISK_FULL` when the ledger can't be used.
 *
 * Opening creates a missing ledger, applies pending migrations in one transaction after an
 * integrity check and a `VACUUM INTO` backup (`ledger.sqlite.bak-<from>-<to>`), and records the
 * owner in `ledger_lock`.
 */
export function openLedger(options: OpenLedgerOptions): LedgerOpening {
  const { storeDir, log } = options;
  const migrations = options.migrations ?? MIGRATIONS;
  const latest = migrations.at(-1)?.version ?? 0;
  mkdirSync(storeDir, { recursive: true, mode: 0o700 });
  const fileName = options.fileName ?? LEDGER_FILE;
  const file = join(storeDir, fileName);
  if (!existsSync(file)) createLedgerFile(storeDir, file, log, fileName);

  const Driver = loadDriver();
  let db: Database;
  try {
    // A normal-locking ledger waits a moment for a replicator's short checkpoint locks.
    db = new Driver(file, {
      timeout: options.locking === "normal" ? 5_000 : 0,
      fileMustExist: true,
    });
  } catch (error) {
    throw diagnose(error, file) ?? error;
  }

  try {
    // EXCLUSIVE before the first WAL access: no shared-memory index, and no other connection.
    if (options.locking !== "normal") db.pragma("locking_mode = EXCLUSIVE");
    else if (options.walAutocheckpoint !== undefined) {
      db.pragma(`wal_autocheckpoint = ${Math.max(0, Math.trunc(options.walAutocheckpoint))}`);
    }
    const mode = db.pragma("journal_mode = WAL", { simple: true });
    if (mode !== "wal") throw unreadable(file, `its journal mode is ${String(mode)}, not WAL`);
    db.pragma("synchronous = FULL");
    db.pragma("foreign_keys = ON");
    // A write transaction takes and keeps the exclusive lock from the start (D81).
    db.prepare("BEGIN EXCLUSIVE").run();
    try {
      db.prepare(
        "INSERT OR REPLACE INTO ledger_lock (id, pid, start_time, acquired_at) VALUES (1, ?, ?, ?)",
      ).run(options.owner.pid, options.owner.startTime, new Date().toISOString());
      db.prepare("COMMIT").run();
    } catch (error) {
      if (db.inTransaction) db.prepare("ROLLBACK").run();
      throw error;
    }
  } catch (error) {
    db.close();
    if (sqliteCode(error) === "SQLITE_BUSY") return { ok: false, reason: "locked" };
    if (error instanceof RpcError) throw error;
    if (/no such table/.test((error as Error).message)) {
      throw unreadable(file, "it isn't a Mostra ledger");
    }
    throw diagnose(error, file) ?? error;
  }

  try {
    removeAbandonedFiles(storeDir);
    const migrated = migrate(db, file, storeDir, latest, migrations, options);
    return { ok: true, ledger: wrap(db, file, latest, migrated) };
  } catch (error) {
    db.close();
    throw diagnose(error, file) ?? error;
  }
}

function migrate(
  db: Database,
  file: string,
  storeDir: string,
  latest: number,
  migrations: readonly Migration[],
  options: OpenLedgerOptions,
): Ledger["migrated"] {
  const current = db
    .prepare("SELECT version, runtime_version FROM schema_migration ORDER BY version DESC LIMIT 1")
    .get() as { version: number; runtime_version: string } | undefined;
  const from = current?.version ?? 0;
  if (from > latest) {
    throw new RpcError(
      createDiagnostic("MOSTRA_HOME_TOO_NEW", {
        message: `This home's ledger is at schema version ${from}, written by Mostra ${current?.runtime_version ?? "unknown"}; this runtime (${options.runtimeVersion}) understands schema versions up to ${latest}.`,
      }),
    );
  }
  if (from === latest) return undefined;

  let backup: string | undefined;
  if (from > 0) {
    const check = db.pragma("quick_check") as { quick_check: string }[];
    const problems = check.map((row) => row.quick_check).filter((text) => text !== "ok");
    if (problems.length > 0) {
      throw unreadable(
        file,
        `SQLite's integrity check failed (${problems.slice(0, 3).join("; ")})`,
      );
    }
    backup = join(storeDir, `${options.fileName ?? LEDGER_FILE}.bak-${from}-${latest}`);
    rmSync(backup, { force: true });
    // VACUUM INTO writes a consistent copy through SQLite, fsynced under synchronous=FULL;
    // copying the file with fs would drop this process's lock (DATA_MODEL §1).
    db.prepare("VACUUM INTO ?").run(backup);
    options.log.info("ledger.backup", { file: backup, from, to: latest });
  }

  const pending = migrations.filter((migration) => migration.version > from);
  const apply = db.transaction(() => {
    const target = queries(db);
    for (const migration of pending) {
      migration.up(target);
      target.run(
        "INSERT INTO schema_migration (version, name, runtime_version, applied_at) VALUES (?, ?, ?, ?)",
        migration.version,
        migration.name,
        options.runtimeVersion,
        new Date().toISOString(),
      );
    }
  });
  apply.immediate();
  options.log.info("ledger.migrated", { from, to: latest });
  return backup === undefined ? { from, to: latest } : { from, to: latest, backup };
}

function inodeOf(file: string): string | undefined {
  try {
    const stats = statSync(file);
    return `${stats.dev}:${stats.ino}`;
  } catch {
    return undefined;
  }
}

function wrap(
  db: Database,
  file: string,
  schemaVersion: number,
  migrated: Ledger["migrated"],
): Ledger {
  const target = queries(db);
  let open = true;
  const listeners = new Set<() => void>();
  // SQLite keeps writing to a ledger whose file was removed (its open descriptors outlive the
  // name), and the data would be lost on close. Every write checks that the file is still the one
  // it opened, before and after the commit, and fails closed otherwise (FAILURE_MODEL §3).
  const opened = inodeOf(file);
  const assertInPlace = (): void => {
    if (inodeOf(file) === opened) return;
    throw new RpcError(
      createDiagnostic("MOSTRA_HOME_GONE", {
        message: `The ledger ${file} was moved or deleted while the instance was running.`,
      }),
    );
  };
  const guarded = <T>(run: () => T): T => {
    try {
      return run();
    } catch (error) {
      throw diagnose(error, file) ?? error;
    }
  };
  return {
    file,
    schemaVersion,
    migrated,
    write<T>(fn: (db: LedgerDb) => T): T {
      assertInPlace();
      const result = guarded(() => db.transaction(() => fn(target)).immediate());
      assertInPlace();
      // A write nested in another commits with the outer one; listeners hear of that one.
      if (db.inTransaction) return result;
      for (const listener of listeners) {
        try {
          listener();
        } catch {
          // A listener's failure is its own; the commit stands.
        }
      }
      return result;
    },
    onCommit(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read<T>(fn: (db: LedgerDb) => T): T {
      return guarded(() => db.transaction(() => fn(target)).deferred());
    },
    checkIntegrity() {
      const rows = db.pragma("integrity_check") as { integrity_check: string }[];
      const problems = rows.map((row) => row.integrity_check).filter((text) => text !== "ok");
      return { ok: problems.length === 0, problems };
    },
    close() {
      if (!open) return;
      open = false;
      db.close();
    },
  };
}

/** A lock held by {@link holdLock}. */
export interface HeldLock {
  readonly file: string;
  /** Releases it. Idempotent. */
  release(): void;
}

/**
 * Takes an advisory lock that the operating system releases when this process dies (DATA_MODEL
 * §7.1, D165): `file` is a one-row SQLite database held in `locking_mode=EXCLUSIVE` with a write
 * transaction open, so no other process can open it, and no stale PID file can outlive its
 * owner. Needs no native addon beyond the ledger's own driver. Answers `undefined` when another
 * process holds it.
 */
export function holdLock(file: string, owner: LedgerOwner): HeldLock | undefined {
  const Driver = loadDriver();
  const db = new Driver(file, { timeout: 0 });
  try {
    db.pragma("locking_mode = EXCLUSIVE");
    db.pragma("journal_mode = DELETE");
    db.prepare("BEGIN EXCLUSIVE").run();
    db.exec(
      "CREATE TABLE IF NOT EXISTS holder (id INTEGER PRIMARY KEY CHECK (id = 1), pid, start_time, at)",
    );
    db.prepare("INSERT OR REPLACE INTO holder (id, pid, start_time, at) VALUES (1, ?, ?, ?)").run(
      owner.pid,
      owner.startTime,
      new Date().toISOString(),
    );
    // The transaction stays open: its lock is the lock.
  } catch (error) {
    db.close();
    if (sqliteCode(error) === "SQLITE_BUSY") return undefined;
    throw diagnose(error, file) ?? error;
  }
  let held = true;
  return {
    file,
    release() {
      if (!held) return;
      held = false;
      try {
        db.prepare("ROLLBACK").run();
      } finally {
        db.close();
      }
    },
  };
}
