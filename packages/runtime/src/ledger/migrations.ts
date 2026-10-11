/**
 * The ledger's schema migrations (DATA_MODEL §3, §6), in order. Each package that adds tables adds
 * one migration at the end; a released migration never changes. Version 0 is the bootstrap every
 * ledger file is created with (`schema_migration` and `ledger_lock`).
 */
import type { MigrationDb } from "./types.ts";

/** One forward step of the ledger schema. */
export interface Migration {
  /** 1, 2, 3 … with no gaps. */
  readonly version: number;
  /** A short name for logs and `schema_migration.name`. */
  readonly name: string;
  /** Applies the step. Runs inside the migration transaction. */
  up(db: MigrationDb): void;
}

/** The bootstrap schema, written into every new ledger file before it is linked into place. */
export const BOOTSTRAP_SQL = `
CREATE TABLE schema_migration (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  runtime_version TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
CREATE TABLE ledger_lock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pid INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  acquired_at TEXT NOT NULL
);
`;

/** Every migration of this runtime, in order. */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "child processes",
    up(db) {
      // Every child process the supervisor started, so a restarted supervisor can reap them
      // (RT-09, FAILURE_MODEL §2). `start_time` is the opaque process identity of
      // processes/identity.ts; `pgid` is the group to signal.
      db.exec(`
        CREATE TABLE child (
          pid INTEGER NOT NULL,
          start_time TEXT NOT NULL,
          kind TEXT NOT NULL,
          owner_ref TEXT NOT NULL,
          pgid INTEGER NOT NULL,
          started_at TEXT NOT NULL,
          parent_pid INTEGER,
          PRIMARY KEY (pid, start_time)
        );
      `);
    },
  },
];
