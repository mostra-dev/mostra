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
  {
    version: 2,
    name: "artifacts, versions and events",
    up(db) {
      // DATA_MODEL §3. `artifact` mirrors the latest version's manifest metadata; `version` rows
      // are immutable (VR-01, invariant 3) and the trigger refuses any UPDATE. `event` is
      // append-only; WP-03 appends `artifact.created` and `version.published`, WP-06 reads them.
      // `request` records the result of each mutating request with a `requestId` (H-03).
      db.exec(`
        CREATE TABLE artifact (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          family TEXT,
          links_json TEXT NOT NULL,
          policy_json TEXT,
          created_at TEXT NOT NULL,
          latest_version_id TEXT
        );
        CREATE TABLE source_binding (
          path TEXT PRIMARY KEY,
          artifact_id TEXT NOT NULL REFERENCES artifact(id),
          bound_at TEXT NOT NULL
        );
        CREATE INDEX source_binding_artifact ON source_binding (artifact_id);
        CREATE TABLE version (
          id TEXT PRIMARY KEY,
          artifact_id TEXT NOT NULL REFERENCES artifact(id),
          number INTEGER NOT NULL CHECK (number >= 1),
          source_digest TEXT NOT NULL,
          env_digest TEXT NOT NULL,
          output_digest TEXT NOT NULL,
          manifest_json TEXT NOT NULL,
          forced_codes_json TEXT,
          published_at TEXT NOT NULL,
          UNIQUE (artifact_id, number)
        );
        CREATE TRIGGER version_immutable BEFORE UPDATE ON version
        BEGIN
          SELECT RAISE(ABORT, 'published versions are immutable');
        END;
        CREATE TABLE event (
          cursor INTEGER PRIMARY KEY AUTOINCREMENT,
          artifact_id TEXT,
          seq INTEGER,
          type TEXT NOT NULL,
          actor_json TEXT NOT NULL,
          causation_json TEXT,
          payload_json TEXT NOT NULL,
          at TEXT NOT NULL,
          UNIQUE (artifact_id, seq)
        );
        CREATE TRIGGER event_append_only BEFORE UPDATE ON event
        BEGIN
          SELECT RAISE(ABORT, 'events are append-only');
        END;
        CREATE TABLE request (
          method TEXT NOT NULL,
          request_id TEXT NOT NULL,
          result_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (method, request_id)
        );
      `);
    },
  },
  {
    version: 3,
    name: "dependencies",
    up(db) {
      // D95. `dependency_lock` holds each artifact's working lockfile, keyed by its artifact ID,
      // or by `path:<real path>` until its first publish binds it (re-keyed in that publish's
      // transaction); `added_json` lists the packages added through deps/add, which stay in the
      // lockfile whether or not the source imports them. `dependency_package` indexes what the
      // home's package store holds, so an offline request for anything else fails at once (DP-04).
      db.exec(`
        CREATE TABLE dependency_lock (
          key TEXT PRIMARY KEY,
          lock_text TEXT NOT NULL,
          added_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE dependency_package (
          name TEXT NOT NULL,
          version TEXT NOT NULL,
          stored_at TEXT NOT NULL,
          PRIMARY KEY (name, version)
        );
      `);
    },
  },
  {
    version: 4,
    name: "addressing, tokens and sessions",
    up(db) {
      // DATA_MODEL §3, D97, D98, D99. `port_lease` gives the shell and each artifact a stable
      // port per home. `token` keeps only the SHA-256 of each capability secret; `is_default`
      // marks the artifact's default link (one live default per artifact, by the partial unique
      // index) and `pinned_version` the version number a link's URL names, so a rotation keeps
      // it. `session` keeps the SHA-256 of each session cookie, the origin it was issued for and,
      // for an artifact frame, the version it entered (D98 item 5).
      db.exec(`
        CREATE TABLE port_lease (
          port INTEGER PRIMARY KEY CHECK (port BETWEEN 1 AND 65535),
          purpose TEXT NOT NULL CHECK (purpose IN ('shell', 'artifact', 'demo')),
          owner_ref TEXT NOT NULL,
          leased_at TEXT NOT NULL,
          UNIQUE (purpose, owner_ref)
        );
        CREATE TABLE token (
          id TEXT PRIMARY KEY,
          secret_hash TEXT NOT NULL UNIQUE,
          artifact_id TEXT NOT NULL REFERENCES artifact(id),
          scopes_json TEXT NOT NULL,
          viewer_id TEXT,
          expires_at TEXT,
          revoked_at TEXT,
          created_at TEXT NOT NULL,
          is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
          pinned_version INTEGER CHECK (pinned_version >= 1),
          replaced_by TEXT,
          CHECK (is_default = 0 OR (revoked_at IS NULL AND expires_at IS NULL))
        );
        CREATE UNIQUE INDEX token_default ON token (artifact_id) WHERE is_default = 1;
        CREATE INDEX token_artifact ON token (artifact_id);
        CREATE TRIGGER token_revocation_final BEFORE UPDATE ON token
        WHEN OLD.revoked_at IS NOT NULL OR NEW.secret_hash IS NOT OLD.secret_hash
          OR NEW.artifact_id IS NOT OLD.artifact_id OR NEW.scopes_json IS NOT OLD.scopes_json
        BEGIN
          SELECT RAISE(ABORT, 'a token never changes its grant, and a revoked token stays revoked');
        END;
        CREATE TABLE session (
          id TEXT PRIMARY KEY,
          token_id TEXT NOT NULL REFERENCES token(id),
          origin TEXT NOT NULL,
          mode TEXT NOT NULL CHECK (mode IN ('cookie', 'worker')),
          -- The SHA-256 of the session's CSRF token, which is derived from the cookie (D98).
          csrf TEXT NOT NULL,
          version_id TEXT REFERENCES version(id),
          created_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL
        );
        CREATE INDEX session_token ON session (token_id);
      `);
    },
  },
];
