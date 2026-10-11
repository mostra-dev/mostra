# Mostra data model

**Status:** Settled v1 data model (C03-A). The supervisor is the only writer (D58, D71). Hosts never see this storage. They see the domain objects of [INTERFACES.md](INTERFACES.md). Table sketches give the columns and constraints that carry invariants. A WP may add indexes and housekeeping columns, but not weaken a constraint listed here.

## 1. The home

```text
<home>/                        default ~/.mostra (macOS), ${XDG_DATA_HOME:-~/.local/share}/mostra (Linux); mode 0700 (D85)
  config.json                  home settings written by `mostra` and by hosts through HomeConfig
  instance.json                discovery record of the running supervisor (D81): pid, start time, socket, runtime version, revisions; never a lock
  store/ledger.sqlite          the ledger (WAL, synchronous=FULL, locking_mode=EXCLUSIVE: no -shm file), with -wal
  store/ledger.sqlite.bak-<from>-<to>   backup written before a migration (§6)
  versions/<versionId>/        immutable: manifest.json, client/, server/ (optional), registry.json, lock.yaml
  sources/<artifactId>/<sourceDigest>.tar.zst   source snapshots for every published version (H-11)
  blobs/<sha256>               crops, screenshots, recordings, attachments (content-addressed)
  deps/store/                  shared content-addressed package store (pnpm-compatible, MIT parts only, D20)
  deps/locks/<lockDigest>/     per-lockfile node_modules layouts, hard-linked from the store
  cache/builds/<digests>/      verify-built outputs awaiting publish; LRU-capped at 5 GB (D47)
  cache/verify/<digests>.json  cached verdicts (D41)
  secrets/<scope>/<name>       one file per secret, mode 0600 (D44)
  logs/                        rotated supervisor and child logs, capability URLs redacted
<runtime dir>/<home-hash>.sock control socket (ARCHITECTURE §4, D82): runtime dir is MOSTRA_RUNTIME_DIR, else ~/.mostra/run (macOS),
                               $XDG_RUNTIME_DIR/mostra when owned and 0700, else ${XDG_STATE_HOME:-~/.local/state}/mostra/run (Linux);
                               home-hash is 16 Crockford base32 characters of SHA-256(realpath(home))
```

**Who owns the home** (D81). The supervisor holding the ledger's exclusive SQLite lock owns the home. The operating system releases the lock when the process dies. The socket and `instance.json` are only how clients find that owner. Because the lock excludes every other connection, any other ledger reader (including `mostra doctor`'s integrity check) goes through the supervisor, or runs only when no supervisor holds the lock. Within the supervisor, nothing but SQLite opens the ledger file: POSIX releases a process's locks on a file when any descriptor for it closes.

**Why sources are snapshotted.** Artifacts, versions and submissions must stay readable after the authoring directory disappears (HO-08, H-11). A version's source snapshot also makes `verify` regression baselines and `export bundle` independent of the working tree.

## 2. Identity and digests

- **`sourceDigest`** is the SHA-256 of a canonical listing of the source tree: for every file, its path (relative, `/`-separated, NFC), its executable bit and the SHA-256 of its bytes, sorted by path. It excludes `node_modules/`, `.git/`, `.mostra/`, editor swap files and anything matched by `.mostraignore`. Content is hashed as bytes, never normalized.
- **`envDigest`** is the SHA-256 of canonical JSON: `{ mostraVersion, kitVersion, kitBase, mode, lockDigest, buildConfigDigest, browserProtocolRevision }`. `lockDigest` hashes the frozen lockfile. `buildConfigDigest` covers Mostra's build settings for this mode and its target list.
- **`versionId`** is `ver_` plus the first 26 characters of the SHA-256 of `sourceDigest ‖ envDigest` in Crockford base32 (`0-9A-HJKMNP-TV-Z`, uppercase, the ULID alphabet; D77), computed by `VersionId.fromSha256`. Publishing the same pair again returns the existing version (`reused: true`). The version number is a per-artifact sequence, for people.
- **`outputDigest`** is the SHA-256 of the canonical listing of the build output, recorded and never used as identity (VR-01).
- **Artifact identity.** An artifact's `id` comes from its manifest (D51) or from a binding of its canonical source path, created at first publish. `source_bindings` makes path → artifact unique, and a manifest `id` claimed by a second path is `MOSTRA_PUBLISH_ID_CONFLICT`.

## 3. Ledger tables

```sql
-- Artifacts, versions, views
artifact(id PK, title, family, links_json, policy_json, created_at, latest_version_id)
source_binding(path PK, artifact_id FK, bound_at)
version(id PK, artifact_id FK, number, source_digest, env_digest, output_digest, manifest_json,
        forced_codes_json, published_at, UNIQUE(artifact_id, number))
viewer(id PK, kind CHECK(kind IN ('local','tailnet','token','host')), external_ref, name, UNIQUE(kind, external_ref))
view(id PK, artifact_id, version_id FK, viewer_id FK, opened_at, closed_at, live_cursor_json)
follow(viewer_id, artifact_id, PRIMARY KEY(viewer_id, artifact_id))          -- D63

-- Fields: one document per scope (viewer draft, or artifact state)
document(id PK, artifact_id, scope CHECK(scope IN ('viewer','artifact')), viewer_id NULL,
         revision INTEGER NOT NULL, epoch INTEGER NOT NULL DEFAULT 1,
         UNIQUE(artifact_id, scope, viewer_id, epoch))
field(document_id FK, field_id, value_json, field_rev INTEGER, updated_by_json, updated_at,
      sensitive BOOLEAN, orphaned_from_version INTEGER NULL, PRIMARY KEY(document_id, field_id))
mutation(id PK, document_id, result_json, applied_at)                     -- idempotency: mutation IDs replay their result

-- Submissions and delivery
submission(id PK, artifact_id, version_id, view_id, viewer_id, channel, epoch, scope_key,
           draft_document_id, draft_revision, state_revision NULL, snapshot_json, digest, stale_view BOOLEAN,
           request_id NULL UNIQUE, created_at,
           UNIQUE(artifact_id, scope_key, epoch))   -- scope_key: '' for once/per-artifact, viewer_id for per-viewer; epochs bump epoch
delivery(id PK, submission_id FK, port_owner, state CHECK(state IN ('pending','delivered','rejected','undeliverable')),
         attempts, next_attempt_at, last_error_json, updated_at, UNIQUE(submission_id, port_owner))

-- Events
event(cursor INTEGER PK AUTOINCREMENT, artifact_id, seq INTEGER, type, actor_json, causation_json, payload_json, at,
      UNIQUE(artifact_id, seq))
subscriber(name PK, filter_json, acked_cursor)                           -- durable host subscriptions

-- Review
thread(id PK, artifact_id, version_id, view_id, anchor_json, crop_blob, status, created_by, created_at)
comment(id PK, thread_id FK, author_viewer_id, text, at, edited_at NULL)
-- choices are fields: review.<setId>.choice (D65)

-- Actions and live data
action_run(id PK, artifact_id, version_id, view_id NULL, viewer_id NULL, action, args_json, key NULL, client_key,
           status CHECK(status IN ('queued','running','succeeded','failed','cancelled')), reason NULL,
           result_json NULL, error_json NULL, log_blob NULL, log_truncated BOOLEAN, started_at, finished_at,
           UNIQUE(artifact_id, action, key))
live_value(artifact_id, key, revision INTEGER, value_json, producer_version_id, at, PRIMARY KEY(artifact_id, key))
live_ring(artifact_id, key, revision, value_json, at, PRIMARY KEY(artifact_id, key, revision))

-- Addressing and processes
port_lease(port PK, purpose CHECK(purpose IN ('shell','artifact','demo')), owner_ref, leased_at, UNIQUE(purpose, owner_ref))
token(id PK, secret_hash, artifact_id, scopes_json, viewer_id NULL, expires_at NULL, revoked_at NULL, created_at)
session(id PK, token_id FK, origin, mode CHECK(mode IN ('cookie','worker')), csrf, created_at, last_seen_at)
share(id PK, artifact_id, via, hostname, token_id, started_at, stopped_at NULL)
child(pid, start_time, kind, owner_ref, pgid, started_at, parent_pid NULL, PRIMARY KEY(pid, start_time))  -- parent_pid: the child that adopted it
schema_migration(version PK, name, runtime_version, applied_at)
ledger_lock(id PK CHECK(id = 1), pid, start_time, acquired_at)            -- written when the lock is taken (D81)
```

Invariants carried by constraints:
- **`once`:** at most one submission per scope key and epoch (H-02).
- **`epochs`:** each submit bumps `document.epoch` and links to the previous epoch through the snapshot.
- **One run per explicit key** per artifact and action (AC-03).
- **One durable result per mutation ID** (IN-01).
- **One delivery row per submission and port owner**, which makes the outbox idempotent (IN-12).
- **Event order:** the home-wide cursor gives total order, and the per-artifact sequence gives each artifact's order (IN-08).
- **Leases:** each port has exactly one lease holder.

`snapshot_json` is the canonical answer document. Its digest is SHA-256 over RFC 8785 (JCS) canonical JSON. Submissions are write-once: no `UPDATE` touches `submission` after insert. A test in the interaction WP enforces this with a trigger (invariant 4).

## 4. Event catalog

Every durable event has `{ cursor, artifactId, seq, type, at, actor: { kind: "viewer" | "agent" | "host" | "mostra", id? }, causation?: { runId?, mutationId?, submissionId? }, payload }`.

| Type | Payload (summary) |
|---|---|
| `artifact.created` | title, family |
| `version.published` | versionId, number, forced codes |
| `view.opened` / `view.closed` | viewId, versionId, viewer |
| `draft.changed` | documentId, revision, field IDs (sensitive values redacted, other values included) |
| `draft.conflict` | field IDs, revisions |
| `state.changed` | revision, field IDs and values (D63) |
| `submission.created` | submissionId, versionId, viewId, channel, epoch, staleView |
| `submission.delivered` / `submission.rejected` / `submission.undeliverable` | submissionId, port owner, reason |
| `signal.raised` | name, payload, source (`shell`, `artifact`, `action`) |
| `review.thread.created` / `review.comment.added` / `review.thread.resolved` / `review.thread.reopened` | thread and comment IDs, anchor summary |
| `action.started` / `action.succeeded` / `action.failed` / `action.cancelled` | runId, action, reason |
| `host.<name>` | any payload, emitted by server code (AC-05) |
| `worker.crashed` | versionId, cause, restart backoff |
| `share.started` / `share.stopped` | via, hostname |
| `token.revoked` | tokenId |

These are ephemeral and never stored (D47, D63): presence, live updates, action progress and log lines (the log is stored on the run, not as events), terminal output and save acknowledgments.

**Compaction** (D47) is opt-in (`mostra gc --compact-events --before <cursor>`). It replaces an artifact's events before a cursor with one `artifact.compacted` event that holds a state summary. Subscribers whose acknowledged cursor is earlier get `MOSTRA_HOST_CURSOR_COMPACTED` and the summary, never a silent gap.

## 5. Values and limits

- **Field values** are JSON. Binary data goes to blobs, referenced as `{ "$blob": sha256, "type": mime }`.
- **Limits.** 1 MiB per field value and 16 MiB per document (D62 class, configurable). Exceeding either is `MOSTRA_FIELD_TOO_LARGE`, never truncation.
- **Live values.** 4 MiB each. Ring buffers are bounded by count.
- **Run logs** are capped at 1 MB with a truncation marker (D47).

## 6. Migrations

The ledger carries `schema_migration`. A new ledger is built in a temporary file with `schema_migration` and `ledger_lock`, then linked into place without replacing anything, so an existing `ledger.sqlite` is always a complete database and Mostra never recreates an empty ledger over one. A newer runtime migrates forward in one transaction at start-up, after `PRAGMA quick_check` passes and a file-level backup (`ledger.sqlite.bak-<from>-<to>`, written with `VACUUM INTO`, which SQLite fsyncs under `synchronous=FULL`; copying the file would drop the supervisor's lock). An older runtime refuses a newer ledger with `MOSTRA_HOME_TOO_NEW`, naming the schema version and the runtime version that wrote it. A file that isn't a Mostra ledger, or can't be read, is `MOSTRA_HOME_LEDGER_UNREADABLE`. `child.start_time` is an opaque identity of a process start (the boot plus `/proc/<pid>/stat` start ticks on Linux, the boot plus `ps -o lstart` seconds on macOS). Version directories, blobs and source snapshots are immutable, so they never migrate.
