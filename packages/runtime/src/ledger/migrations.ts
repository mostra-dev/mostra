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
      // it. `shell_origin` is the address the link was minted for: a link works only there, so a
      // program that later holds an abandoned port can't use the secrets of old links (D97).
      // `session` keeps the SHA-256 of each session cookie, the origin it was issued for and, for
      // an artifact frame, the version it entered (D98 item 5). `request.params_digest` makes a
      // requestId replay only the request it recorded (H-03).
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
          shell_origin TEXT NOT NULL,
          replaced_by TEXT,
          CHECK (is_default = 0 OR (revoked_at IS NULL AND expires_at IS NULL))
        );
        CREATE UNIQUE INDEX token_default ON token (artifact_id) WHERE is_default = 1;
        CREATE INDEX token_artifact ON token (artifact_id);
        CREATE TRIGGER token_revocation_final BEFORE UPDATE ON token
        WHEN OLD.revoked_at IS NOT NULL OR NEW.secret_hash IS NOT OLD.secret_hash
          OR NEW.artifact_id IS NOT OLD.artifact_id OR NEW.scopes_json IS NOT OLD.scopes_json
          OR NEW.expires_at IS NOT OLD.expires_at OR NEW.pinned_version IS NOT OLD.pinned_version
          OR NEW.shell_origin IS NOT OLD.shell_origin
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
        ALTER TABLE request ADD COLUMN params_digest TEXT;
      `);
    },
  },
  {
    version: 5,
    name: "interaction ledger",
    up(db) {
      // DATA_MODEL §3, D101 to D106. Viewers are people (one `local`, one `token` viewer per host
      // key); a view is one frame load of one version. A document is a viewer's draft or the
      // artifact's state: its revision and epoch only grow (trigger), and each field keeps the
      // revision that last wrote it, deletions included, so conflicts are exact. A mutation ID
      // replays its recorded result. Submissions are write-once (trigger); `position` is the
      // cursor of their `submission.created` event, the order deliveries replay in. A terminal
      // delivery never changes again (trigger). `subscriber` keeps durable acknowledged cursors.
      // A token's viewer joins its immutable grant. INSERT OR REPLACE would delete a row without
      // the DELETE and UPDATE triggers, so write-once tables also refuse an insert over an
      // existing row (Claude review finding 7). `artifact.policy_chosen_json` keeps the policy a
      // publish named explicitly, which later publishes keep until another names one (D102).
      db.exec(`
        CREATE TABLE viewer (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('local', 'tailnet', 'token', 'host')),
          external_ref TEXT NOT NULL,
          name TEXT,
          created_at TEXT NOT NULL,
          UNIQUE (kind, external_ref)
        );
        CREATE TABLE view (
          id TEXT PRIMARY KEY,
          artifact_id TEXT NOT NULL REFERENCES artifact(id),
          version_id TEXT NOT NULL REFERENCES version(id),
          viewer_id TEXT NOT NULL REFERENCES viewer(id),
          token_id TEXT REFERENCES token(id),
          opened_cursor INTEGER,
          opened_at TEXT NOT NULL,
          closed_at TEXT,
          live_cursor_json TEXT
        );
        CREATE INDEX view_artifact ON view (artifact_id, viewer_id);
        CREATE TABLE document (
          id INTEGER PRIMARY KEY,
          artifact_id TEXT NOT NULL REFERENCES artifact(id),
          scope TEXT NOT NULL CHECK (scope IN ('viewer', 'artifact')),
          viewer_id TEXT REFERENCES viewer(id),
          revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
          epoch INTEGER NOT NULL DEFAULT 1 CHECK (epoch >= 1),
          size INTEGER NOT NULL DEFAULT 0 CHECK (size >= 0),
          CHECK ((scope = 'viewer') = (viewer_id IS NOT NULL)),
          UNIQUE (artifact_id, scope, viewer_id)
        );
        CREATE UNIQUE INDEX document_state ON document (artifact_id) WHERE scope = 'artifact';
        CREATE TRIGGER document_monotonic BEFORE UPDATE ON document
        WHEN NEW.revision < OLD.revision OR NEW.epoch < OLD.epoch
          OR NEW.artifact_id IS NOT OLD.artifact_id OR NEW.scope IS NOT OLD.scope
          OR NEW.viewer_id IS NOT OLD.viewer_id
        BEGIN
          SELECT RAISE(ABORT, 'a document''s revision and epoch only grow');
        END;
        CREATE TABLE field (
          document_id INTEGER NOT NULL REFERENCES document(id),
          field_id TEXT NOT NULL,
          value_json TEXT NOT NULL,
          deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
          field_rev INTEGER NOT NULL CHECK (field_rev >= 1),
          updated_by_json TEXT,
          updated_at TEXT NOT NULL,
          sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1)),
          label TEXT,
          required INTEGER CHECK (required IN (0, 1)),
          orphaned_from_version INTEGER,
          PRIMARY KEY (document_id, field_id)
        );
        CREATE TABLE mutation (
          id TEXT PRIMARY KEY,
          document_id INTEGER NOT NULL REFERENCES document(id),
          params_digest TEXT NOT NULL,
          result_json TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE submission (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL UNIQUE,
          artifact_id TEXT NOT NULL REFERENCES artifact(id),
          version_id TEXT NOT NULL REFERENCES version(id),
          view_id TEXT NOT NULL REFERENCES view(id),
          viewer_id TEXT NOT NULL REFERENCES viewer(id),
          channel TEXT NOT NULL CHECK (channel IN ('shell', 'artifact')),
          policy_json TEXT NOT NULL,
          epoch INTEGER NOT NULL CHECK (epoch >= 1),
          scope_key TEXT NOT NULL,
          previous_id TEXT REFERENCES submission(id),
          draft_document_id INTEGER NOT NULL REFERENCES document(id),
          draft_revision INTEGER NOT NULL,
          state_revision INTEGER,
          latest_version_number INTEGER,
          snapshot_json TEXT NOT NULL,
          digest TEXT NOT NULL,
          stale_view INTEGER NOT NULL CHECK (stale_view IN (0, 1)),
          request_id TEXT UNIQUE,
          created_at TEXT NOT NULL,
          UNIQUE (artifact_id, scope_key, epoch)
        );
        CREATE INDEX submission_artifact ON submission (artifact_id, position);
        CREATE TRIGGER submission_write_once BEFORE UPDATE ON submission
        BEGIN
          SELECT RAISE(ABORT, 'submissions are immutable');
        END;
        CREATE TRIGGER submission_kept BEFORE DELETE ON submission
        BEGIN
          SELECT RAISE(ABORT, 'submissions are immutable');
        END;
        -- INSERT OR REPLACE deletes the old row without the DELETE trigger: refuse it at insert.
        CREATE TRIGGER submission_not_replaced BEFORE INSERT ON submission
        WHEN EXISTS (SELECT 1 FROM submission WHERE id = NEW.id OR position = NEW.position
          OR (artifact_id = NEW.artifact_id AND scope_key = NEW.scope_key AND epoch = NEW.epoch))
        BEGIN
          SELECT RAISE(ABORT, 'submissions are immutable');
        END;
        CREATE TABLE delivery (
          id TEXT PRIMARY KEY,
          submission_id TEXT NOT NULL REFERENCES submission(id),
          position INTEGER NOT NULL,
          port_owner TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('pending', 'delivered', 'rejected', 'undeliverable')),
          attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
          next_attempt_at TEXT,
          last_error_json TEXT,
          reason TEXT,
          updated_at TEXT NOT NULL,
          UNIQUE (submission_id, port_owner)
        );
        CREATE INDEX delivery_owner ON delivery (port_owner, state, position);
        CREATE TRIGGER delivery_terminal BEFORE UPDATE ON delivery
        WHEN OLD.state <> 'pending' OR NEW.submission_id IS NOT OLD.submission_id
          OR NEW.port_owner IS NOT OLD.port_owner OR NEW.position IS NOT OLD.position
        BEGIN
          SELECT RAISE(ABORT, 'a delivery''s terminal state never changes');
        END;
        CREATE TRIGGER delivery_kept BEFORE DELETE ON delivery
        BEGIN
          SELECT RAISE(ABORT, 'deliveries are kept with their submissions');
        END;
        CREATE TRIGGER delivery_not_replaced BEFORE INSERT ON delivery
        WHEN EXISTS (SELECT 1 FROM delivery WHERE id = NEW.id
          OR (submission_id = NEW.submission_id AND port_owner = NEW.port_owner))
        BEGIN
          SELECT RAISE(ABORT, 'a delivery''s terminal state never changes');
        END;
        CREATE TRIGGER version_not_replaced BEFORE INSERT ON version
        WHEN EXISTS (SELECT 1 FROM version WHERE id = NEW.id
          OR (artifact_id = NEW.artifact_id AND number = NEW.number))
        BEGIN
          SELECT RAISE(ABORT, 'published versions are immutable');
        END;
        CREATE TRIGGER token_not_replaced BEFORE INSERT ON token
        WHEN EXISTS (SELECT 1 FROM token WHERE id = NEW.id OR secret_hash = NEW.secret_hash)
        BEGIN
          SELECT RAISE(ABORT, 'a token never changes its grant, and a revoked token stays revoked');
        END;
        CREATE TABLE subscriber (
          name TEXT PRIMARY KEY,
          filter_json TEXT NOT NULL,
          acked_cursor INTEGER NOT NULL DEFAULT 0 CHECK (acked_cursor >= 0),
          updated_at TEXT NOT NULL
        );
        ALTER TABLE artifact ADD COLUMN policy_chosen_json TEXT;
        CREATE INDEX event_artifact ON event (artifact_id, cursor);
        CREATE INDEX event_artifact_type ON event (artifact_id, type, cursor);
        DROP TRIGGER token_revocation_final;
        CREATE TRIGGER token_revocation_final BEFORE UPDATE ON token
        WHEN OLD.revoked_at IS NOT NULL OR NEW.secret_hash IS NOT OLD.secret_hash
          OR NEW.artifact_id IS NOT OLD.artifact_id OR NEW.scopes_json IS NOT OLD.scopes_json
          OR NEW.expires_at IS NOT OLD.expires_at OR NEW.pinned_version IS NOT OLD.pinned_version
          OR NEW.shell_origin IS NOT OLD.shell_origin OR NEW.viewer_id IS NOT OLD.viewer_id
        BEGIN
          SELECT RAISE(ABORT, 'a token never changes its grant, and a revoked token stays revoked');
        END;
      `);
    },
  },
  {
    version: 6,
    name: "views, follows and field versions",
    up(db) {
      // D108, D109, D63. A view records the submit channels and trusted controls in force when it
      // opened, so the shell, the page and the server judge it alike. `follow` keeps each viewer's
      // "Always follow this artifact". A field records the version whose view last wrote it (an
      // orphan's `fromVersion`): the column WP-06 reserved as `orphaned_from_version`, never set,
      // since orphans are derived per view and never stored.
      db.exec(`
        ALTER TABLE field RENAME COLUMN orphaned_from_version TO version_number;
        ALTER TABLE view ADD COLUMN controls_json TEXT;
        CREATE TABLE follow (
          viewer_id TEXT NOT NULL REFERENCES viewer(id),
          artifact_id TEXT NOT NULL REFERENCES artifact(id),
          followed_at TEXT NOT NULL,
          PRIMARY KEY (viewer_id, artifact_id)
        );
      `);
      // Fields written before: each draft change names the view it came from, so the newest
      // change of a field tells its version. Changes whose events were compacted stay unknown.
      const changes = db.all<{
        artifact_id: string;
        payload_json: string;
        version_number: number;
      }>(
        `SELECT event.artifact_id, event.payload_json, version.number AS version_number FROM event
           JOIN view ON view.id = json_extract(event.causation_json, '$.viewId')
           JOIN version ON version.id = view.version_id
          WHERE event.type = 'draft.changed' ORDER BY event.cursor`,
      );
      for (const change of changes) {
        const payload = JSON.parse(change.payload_json) as {
          viewerId?: string;
          changes?: { id: string }[];
        };
        for (const field of payload.changes ?? []) {
          db.run(
            `UPDATE field SET version_number = ? WHERE field_id = ? AND document_id IN
               (SELECT id FROM document WHERE artifact_id = ? AND scope = 'viewer' AND viewer_id = ?)`,
            change.version_number,
            field.id,
            change.artifact_id,
            payload.viewerId ?? null,
          );
        }
      }
    },
  },
  {
    version: 7,
    name: "action runs and live values",
    up(db) {
      // D24, D54, D47, AC-02, AC-03. A run is recorded before any worker starts it. An explicit
      // key allows one run per artifact, function and key, ever (SQLite treats NULL keys as
      // distinct, so keyless runs don't collide); a client key makes a retried request join the
      // run it started. `waiting` is reserved for WP-28's relay (D117, D124). A final run never
      // changes again, and its result batches only grow while it runs.
      db.exec(`
        CREATE TABLE action_run (
          id TEXT PRIMARY KEY,
          artifact_id TEXT NOT NULL REFERENCES artifact(id),
          version_id TEXT NOT NULL REFERENCES version(id),
          view_id TEXT REFERENCES view(id),
          viewer_id TEXT REFERENCES viewer(id),
          action TEXT NOT NULL,
          args_json TEXT NOT NULL,
          key TEXT,
          client_key TEXT NOT NULL,
          status TEXT NOT NULL
            CHECK (status IN ('queued', 'running', 'waiting', 'succeeded', 'failed', 'cancelled')),
          reason TEXT,
          error_json TEXT,
          progress_json TEXT,
          log_text TEXT NOT NULL DEFAULT '',
          log_lines INTEGER NOT NULL DEFAULT 0,
          log_truncated INTEGER NOT NULL DEFAULT 0,
          batches INTEGER NOT NULL DEFAULT 0,
          result_size INTEGER NOT NULL DEFAULT 0,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          UNIQUE (artifact_id, action, key),
          UNIQUE (artifact_id, client_key)
        );
        CREATE INDEX action_run_view ON action_run(view_id);
        CREATE INDEX action_run_open ON action_run(status) WHERE status IN ('queued', 'running', 'waiting');
        CREATE TRIGGER action_run_final_update BEFORE UPDATE ON action_run
          WHEN OLD.status IN ('succeeded', 'failed', 'cancelled')
        BEGIN
          SELECT RAISE(ABORT, 'a finished action run never changes');
        END;
        CREATE TRIGGER action_run_no_delete BEFORE DELETE ON action_run
        BEGIN
          SELECT RAISE(ABORT, 'action runs are kept with their artifact');
        END;
        CREATE TABLE action_run_batch (
          run_id TEXT NOT NULL REFERENCES action_run(id),
          seq INTEGER NOT NULL,
          batch_json TEXT NOT NULL,
          PRIMARY KEY (run_id, seq)
        );
        CREATE TRIGGER action_run_batch_append BEFORE UPDATE ON action_run_batch
        BEGIN
          SELECT RAISE(ABORT, 'a run result batch never changes');
        END;
        -- Write-once like submissions and versions (DATA_MODEL §3): an INSERT OR REPLACE would
        -- delete the row it replaces without firing the DELETE trigger (Opus review 11).
        CREATE TRIGGER action_run_not_replaced BEFORE INSERT ON action_run
        WHEN EXISTS (SELECT 1 FROM action_run WHERE id = NEW.id
          OR (artifact_id = NEW.artifact_id AND client_key = NEW.client_key)
          OR (NEW.key IS NOT NULL AND artifact_id = NEW.artifact_id AND action = NEW.action
              AND key = NEW.key))
        BEGIN
          SELECT RAISE(ABORT, 'an action run is never replaced');
        END;
        CREATE TRIGGER action_run_batch_no_delete BEFORE DELETE ON action_run_batch
        BEGIN
          SELECT RAISE(ABORT, 'a run result batch is kept with its run');
        END;
        CREATE TRIGGER action_run_batch_once BEFORE INSERT ON action_run_batch
        WHEN EXISTS (SELECT 1 FROM action_run_batch WHERE run_id = NEW.run_id AND seq = NEW.seq)
          OR EXISTS (SELECT 1 FROM action_run WHERE id = NEW.run_id
            AND status IN ('succeeded', 'failed', 'cancelled'))
        BEGIN
          SELECT RAISE(ABORT, 'a finished run takes no more result batches');
        END;
      `);
      // D56, D63, LL-04. A live source keeps its latest value with a revision that only grows, and
      // in append mode a bounded ring of recent values. Updates are never events.
      db.exec(`
        CREATE TABLE live_value (
          artifact_id TEXT NOT NULL REFERENCES artifact(id),
          key TEXT NOT NULL,
          revision INTEGER NOT NULL,
          value_json TEXT NOT NULL,
          producer_version_id TEXT,
          at TEXT NOT NULL,
          PRIMARY KEY (artifact_id, key)
        );
        CREATE TRIGGER live_value_revision BEFORE UPDATE ON live_value
          WHEN NEW.revision <= OLD.revision
        BEGIN
          SELECT RAISE(ABORT, 'a live value revision only grows');
        END;
        CREATE TABLE live_ring (
          artifact_id TEXT NOT NULL,
          key TEXT NOT NULL,
          revision INTEGER NOT NULL,
          value_json TEXT NOT NULL,
          at TEXT NOT NULL,
          PRIMARY KEY (artifact_id, key, revision)
        );
      `);
    },
  },
];
