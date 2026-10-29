# Mostra data model

**Status:** Settled v1 data model (C03-A). The supervisor is the only writer (D58, D71). Hosts never see this storage. They see the domain objects of [INTERFACES.md](INTERFACES.md). Table sketches give the columns and constraints that carry invariants. A WP may add indexes and housekeeping columns, but not weaken a constraint listed here.

## 1. The home

```text
<home>/                        default ~/.mostra (macOS), ${XDG_DATA_HOME:-~/.local/share}/mostra (Linux),
                               %LOCALAPPDATA%\mostra (Windows); mode 0700 (D85), on Windows a protected access list
                               granting only the user and SYSTEM, inherited by everything inside (D150)
  config.json                  home settings written by `mostra` and by hosts through HomeConfig (the dependency policy, D95);
                               `hostConfigured: { client, at }`, written once when a host first configures the home or a
                               `mostra-runtime host` instance owns it, and never removed (D140 item 4)
  instance.json                discovery record of the running supervisor (D81): pid, start time, socket, runtime version, revisions; never a lock
  store/ledger.sqlite          the ledger (WAL, synchronous=FULL, locking_mode=EXCLUSIVE: no -shm file), with -wal
  store/ledger.sqlite.bak-<from>-<to>   backup written before a migration (§6)
  versions/<versionId>/        immutable and read-only (files 0444, directories 0555): manifest.json (with `forcedCodes`
                               and, since WP-09, `verify: { status, verifyRevision }`, D138), client/, server/
                               (optional, entry.mjs), registry.json, lock.yaml
  sources/<artifactId>/<sourceDigest>.tar.zst   source snapshots for every published version (H-11)
  blobs/<sha256>               crops, screenshots, recordings, attachments (content-addressed)
  deps/store/                  shared content-addressed package store (pnpm 10's, D20, D94)
  deps/locks/pinned-<digest>/  a version's layout once the warm set moved on: its locked warm versions installed (D135)
  deps/locks/<lockDigest>/     per-lockfile node_modules layouts, hard-linked from the store; each links the warm set
                               through a `warm` symlink and is complete once it carries `.mostra-layout` (D95)
  deps/cache/, deps/state/     the installer's registry metadata (read when offline) and its own state
  deps/tmp/                    scratch projects of resolutions in progress; emptied at every start
  cache/builds/<versionId>/    verify's builds, laid out as version directories, which publish promotes when its own
                               version ID matches (D138 item 5); capped at 5 GB, least recently used first, never one
                               a running verify serves (D47); unfinished `*.tmp-*` builds removed at every start
  cache/staging/               one directory per publish in progress (snapshot copy, build output); emptied at every start
  cache/verify/<key>.json      cached verdicts, keyed by sourceDigest, envDigest and the verify revision (D41, D138),
                               each with whether compile produced a build, which `--force` needs (D138 item 7)
  cache/verify/<key>/          that verdict's screenshots, ARIA snapshots (written redacted) and pixel diffs; a
                               directory no cached verdict names is removed after an hour and at every start
  cache/verify/runs/<run>/     a running verify's sandbox (its scratch ledger); removed when the run ends, and at
                               every start (D138 item 1)
  secrets/<scope>/<name>       one file per secret, mode 0600 (D44)
  keys/capability              32 random bytes, mode 0600: the key capability secrets are derived under (D97)
  logs/                        rotated supervisor and child logs, capability URLs redacted
  cache/dev/<session>/         a `mostra dev` session's scratch state; deleted when the session ends, and at every start
                               (D140 item 12)
<runtime dir>/<home-hash>.sock control socket (ARCHITECTURE §4, D82): runtime dir is MOSTRA_RUNTIME_DIR, else ~/.mostra/run (macOS),
                               $XDG_RUNTIME_DIR/mostra when owned and 0700, else ${XDG_STATE_HOME:-~/.local/state}/mostra/run (Linux);
                               home-hash is 16 Crockford base32 characters of SHA-256(realpath(home)).
                               Windows has no runtime dir: the control pipe is \\.\pipe\mostra-<home-hash>-<16 random
                               hex>, fresh on every bind, owner-only, served by the helper (D150)
```

**The CLI's own directory** (D140 item 5) is per operating-system user, not per home: `MOSTRA_CONFIG_DIR`, else `${XDG_CONFIG_HOME:-~/.config}/mostra` (on Windows `%APPDATA%\mostra`, D151), mode 0700, holding `telemetry.json` (0600, written by rename: the telemetry choice, when the notice of what is sent was shown where sending follows, when the ask-first notice was shown (a separate record, so it never stands for the other), when a flush last started), `telemetry-id` (0600: the random install ID, made by D140's exclusive create, a hard link that fails when the file exists, so processes on a first run agree on one ID without the lock), `telemetry-queue.ndjson` (0600, at most 1,000 events, none older than 7 days) and, while a change is made, `telemetry.lock` (its owner's PID and a token; released only by its owner, taken over when it is older than 10 s and its owner no longer runs, or older than 60 s whoever it names, since a dead owner's PID can name an unrelated live process). Only `@mostra/cli` reads or writes it.

**Who owns the home** (D81). The supervisor holding the ledger's exclusive SQLite lock owns the home. The operating system releases the lock when the process dies. The socket and `instance.json` are only how clients find that owner. Because the lock excludes every other connection, any other ledger reader (including `mostra doctor`'s integrity check) goes through the supervisor, or runs only when no supervisor holds the lock. Within the supervisor, nothing but SQLite opens the ledger file: POSIX releases a process's locks on a file when any descriptor for it closes.

**Why sources are snapshotted.** Artifacts, versions and submissions must stay readable after the authoring directory disappears (HO-08, H-11). A version's source snapshot also makes `verify` regression baselines and `export bundle` independent of the working tree.

## 2. Identity and digests

- **`sourceDigest`** is the SHA-256 of a canonical listing of the source tree: for every file, its path (relative, `/`-separated, NFC), its executable bit and the SHA-256 of its bytes, sorted by path. The listing is the JSON array `[[path, executable, sha256hex], …]` sorted by the paths' UTF-8 bytes. It excludes `node_modules/`, `.git/` and `.mostra/` at any depth, editor swap and backup files (`*.swp` and kin, `*~`, `.#*`, `#*#`), Finder's `.DS_Store`, and anything matched by `.mostraignore` (gitignore rules, in the source root). Symbolic links are followed; a link back into its own ancestry is skipped. A single-file artifact's tree is that one file. Content is hashed as bytes, never normalized. Publish hashes its staging copy of the files, so the digest describes exactly what is built and archived. Every digest is written as lowercase hex.
- **`envDigest`** is the SHA-256 of canonical JSON (RFC 8785): `{ mostraVersion, kitVersion, kitBase, mode, lockDigest, buildConfigDigest, browserProtocolRevision }`. `lockDigest` is the SHA-256 of the frozen lockfile's text (`lock.yaml`, D95): the warm set's packages and versions, and, for an artifact with on-demand packages, each direct one at its exact version (`packages`) and the installer's lockfile, which pins the whole graph (`pnpm`). `buildConfigDigest` covers Mostra's build settings for this mode: the render mode, a settings revision, the base path, source maps, the versions of the bundler and its plugins, and the `tsconfig.json` and `package.json` Mostra writes at the build's root. A build reads nothing else: packages come only from the warm set and the artifact's lockfile (a package's own imports too), and no configuration is read from outside the artifact (INTERFACES §2.1), so these digests cover every input. `kitVersion` and `browserProtocolRevision` are `null` until the kit (WP-18) and the browser protocol (WP-07) exist; their arrival changes `envDigest`, as it should.
- **`versionId`** is `ver_` plus the first 26 characters, in Crockford base32 (`0-9A-HJKMNP-TV-Z`, uppercase, the ULID alphabet; D77), of the SHA-256 of the artifact ID's UTF-8 bytes, one `0x00` byte, and the 32-byte `sourceDigest` and `envDigest` (D89), computed by `VersionId.fromSha256`. Publishing the same source and environment for the same artifact again returns the existing version (`reused: true`). The version number is a per-artifact sequence, for people.
- **`outputDigest`** is the SHA-256 of the canonical listing of the build output (every file under the version's `client/` and `server/`, and `registry.json`, paths relative to the version directory, none executable since the version is sealed read-only), recorded and never used as identity (VR-01).
- **Artifact identity.** An artifact's `id` comes from its manifest (D51) or from a binding of its canonical source path (its real path), created at first publish. `source_bindings` makes path → artifact unique. A manifest `id` must be an artifact ID (`art_` and a ULID), and it wins over a path binding. When a manifest `id` is bound to another path: if that path's entry still claims the `id` (a copy), the publish is `MOSTRA_PUBLISH_ID_CONFLICT`; if it doesn't (the source moved or changed its `id`), the binding moves to the new path. Publishing an earlier version's exact source again reuses that version and makes it the latest again, with a new `version.published` event (`republished: true`).

## 3. Ledger tables

```sql
-- Artifacts, versions, views
artifact(id PK, title, family, links_json, policy_json, policy_chosen_json NULL, created_at, latest_version_id)
                                                    -- policy_json: the policy in force; policy_chosen_json: one a publish named (D102)
source_binding(path PK, artifact_id FK, bound_at)
version(id PK, artifact_id FK, number, source_digest, env_digest, output_digest, manifest_json,
        forced_codes_json, published_at, verify_json NULL, UNIQUE(artifact_id, number))
                                                    -- verify_json: { status, verifyRevision } of the verdict the
                                                    -- version was published on (migration 8, D138 item 4); NULL
                                                    -- before verify; only 'pass' makes a regression baseline
viewer(id PK, kind CHECK(kind IN ('local','tailnet','token','host')), external_ref, name, created_at, UNIQUE(kind, external_ref))
                                                    -- one 'local' viewer; 'token' viewers keyed by view/url's viewer.ref (D104),
                                                    -- and a link's own viewer over a tunnel as 'link:<tokenId>';
                                                    -- 'tailnet' viewers keyed by the Tailscale login (D158 item 2)
view(id PK, artifact_id, version_id FK, viewer_id FK, token_id NULL, opened_cursor, opened_at, closed_at, live_cursor_json,
     controls_json NULL)                                  -- the submit channels and controls in force for this view (D108);
                                                          -- NULL (views before WP-07): both channels
                                                          -- token_id: the link that opened it; a page names only its own link's views
                                                    -- one frame load of one version (D104)
follow(viewer_id, artifact_id, followed_at, PRIMARY KEY(viewer_id, artifact_id))   -- D63: "Always follow this artifact"

-- Fields: one document per scope (viewer draft, or artifact state)
document(id PK, artifact_id, scope CHECK(scope IN ('viewer','artifact')), viewer_id NULL,
         revision INTEGER NOT NULL, epoch INTEGER NOT NULL DEFAULT 1, size INTEGER,
         CHECK((scope = 'viewer') = (viewer_id IS NOT NULL)), UNIQUE(artifact_id, scope, viewer_id))
                                                    -- one draft per viewer, its epoch growing (D103); a partial unique index
                                                    -- makes the artifact-state document (viewer_id NULL) unique too;
                                                    -- a trigger refuses revision or epoch going back
field(document_id FK, field_id, value_json, deleted BOOLEAN, field_rev INTEGER, updated_by_json, updated_at,
      sensitive BOOLEAN, label NULL, required NULL, version_number INTEGER NULL, PRIMARY KEY(document_id, field_id))
                                                    -- a deleted field keeps its row and revision, so a stale write conflicts;
                                                    -- version_number: the version whose view last wrote it, an orphan's
                                                    -- fromVersion (D109; migration 6 renamed orphaned_from_version)
mutation(id PK, document_id, params_digest, result_json, applied_at)      -- idempotency: mutation IDs replay their result,
                                                                          -- only for the same contents (D106)

-- Submissions and delivery
submission(id PK, position UNIQUE, artifact_id, version_id, view_id, viewer_id, channel, policy_json, epoch, scope_key,
           previous_id NULL, draft_document_id, draft_revision, state_revision NULL, latest_version_number NULL,
           snapshot_json, digest, stale_view BOOLEAN, request_id NULL UNIQUE, created_at,
           UNIQUE(artifact_id, scope_key, epoch))   -- scope_key: '' for once/per-artifact, viewer_id for per-viewer and epochs;
                                                    -- epochs bump the draft's epoch; position: the cursor of submission.created
delivery(id PK (dlv_), submission_id FK, position, port_owner (the host's client name; '' for the built-in adapter), state CHECK(state IN ('pending','delivered','rejected','undeliverable')),
         attempts, next_attempt_at, last_error_json, reason NULL, updated_at, UNIQUE(submission_id, port_owner))

-- Events
event(cursor INTEGER PK AUTOINCREMENT, artifact_id, seq INTEGER, type, actor_json, causation_json, payload_json, at,
      UNIQUE(artifact_id, seq))
subscriber(name PK, filter_json, acked_cursor, updated_at)               -- durable host subscriptions

-- Review
thread(id PK, artifact_id, version_id, view_id, anchor_json, crop_blob, status, created_by, created_at)
comment(id PK, thread_id FK, author_viewer_id, text, at, edited_at NULL)
-- choices are fields: review.<setId>.choice (D65)

-- Actions and live data
action_run(id PK, artifact_id, version_id, view_id NULL, viewer_id NULL, action, args_json, key NULL, client_key,
           status CHECK(status IN ('queued','running','waiting','succeeded','failed','cancelled')), reason NULL,
           error_json NULL, progress_json NULL, log_text, log_lines, log_truncated BOOLEAN, batches, result_size,
           started_at, finished_at NULL, UNIQUE(artifact_id, action, key), UNIQUE(artifact_id, client_key))
                                                    -- migration 7 (WP-08, D130): `waiting` is reserved for WP-28's relay;
                                                    -- a final run never changes, is never deleted, and no
                                                    -- insert replaces a run (triggers, D136)
action_run_batch(run_id FK, seq, batch_json, PRIMARY KEY(run_id, seq))   -- the result, as serializer batches;
                                                                          -- append-only: triggers refuse UPDATE, DELETE
                                                                          -- and a batch for a finished run (D136)
live_value(artifact_id, key, revision INTEGER, value_json, producer_version_id NULL, at, PRIMARY KEY(artifact_id, key))
                                                    -- a trigger refuses a revision that doesn't grow; value_json holds
                                                    -- serializer batches (D56); NULL producer: a push
live_ring(artifact_id, key, revision, value_json, at, PRIMARY KEY(artifact_id, key, revision))

-- Addressing and processes
port_lease(port PK, purpose CHECK(purpose IN ('shell','artifact','demo','face')), owner_ref, leased_at, UNIQUE(purpose, owner_ref))
                                                    -- 'face': a tailnet face or a host's external base, keyed
                                                    -- by its face key, so its address survives restarts (D158)
token(id PK, secret_hash UNIQUE, artifact_id FK, scopes_json, viewer_id NULL, expires_at NULL, revoked_at NULL, created_at,
      is_default, pinned_version NULL, shell_origin, replaced_by NULL)  -- one default per artifact; a revoked row never changes;
                                                                       -- a link works only at shell_origin (D97 items 9, 10)
session(id PK, token_id FK, origin, mode CHECK(mode IN ('cookie','worker')), csrf, version_id NULL, created_at, last_seen_at,
        viewer_id NULL FK)                                       -- id: SHA-256 of the cookie; csrf: SHA-256 of the CSRF token (D98);
                                                                 -- viewer_id: the person a host's identity port named for a link
                                                                 -- without a viewer (migration 10, D143 item 2)
share(id PK (shr_), artifact_id FK, via CHECK(via IN ('tailnet','funnel','cloudflare')), hostname, token_id FK, mode,
      plan_json, started_at, expires_at NULL, stopped_at NULL, stop_reason NULL)
                                                    -- plan_json: the faces it uses and their external ports, so a
                                                    -- restart sets tailnet and Funnel shares up again; a share only
                                                    -- ever ends, once (a trigger) (migration 11, D158)
external_base(key PK, listener, artifact_id FK, origin, mode NULL, client, updated_at)
                                                    -- a host's addressing answer, kept so its links work after a
                                                    -- restart before the host is back (HO-10, D158 item 6)
child(pid, start_time, kind, owner_ref, pgid, started_at, parent_pid NULL, PRIMARY KEY(pid, start_time))  -- parent_pid: the child that adopted it;
                                                                 -- start_time `<boot>/<start>`; on Windows `win/<creation time>`
                                                                 -- (100 ns since 1601) and pgid its own PID: its Job Object is
                                                                 -- `Local\mostra-job-<pid>-<creation time>` (D150)
schema_migration(version PK, name, runtime_version, applied_at)
request(method, request_id, result_json, params_digest NULL, created_at, PRIMARY KEY(method, request_id))
                                                                        -- H-03: a mutating request's recorded result, replayed only
                                                                        -- for the same params_digest (D100)
ledger_lock(id PK CHECK(id = 1), pid, start_time, acquired_at)            -- written when the lock is taken (D81)

-- Dependencies (D95)
dependency_lock(key PK, lock_text, added_json, updated_at)   -- an artifact's working lockfile; key: its artifact ID, or
                                                             -- 'path:<real path>' until its first publish binds it
dependency_package(name, version, stored_at, PRIMARY KEY(name, version))   -- what deps/store holds, for offline answers (DP-04)

-- gc (D140 item 14, migration 9)
version_collected(version_id PK FK, collected_at)   -- a version gc removed the files of; write-once (a trigger refuses
                                                    -- UPDATE and an insert over a row); deleted only by the publish that
                                                    -- restores the version's files. The version row itself is never
                                                    -- deleted (a trigger), so its ID and number stay forever
```

Invariants carried by constraints:
- **`once`:** at most one submission per scope key and epoch (H-02).
- **`epochs`:** each submit bumps `document.epoch` and links to the previous epoch through the snapshot.
- **One run per explicit key** per artifact and action (AC-03), and one per client key per artifact, so a retried start joins its own run (D130).
- **Finished runs never change** (a trigger), and their result batches never change (D130).
- **Live revisions only grow** per artifact and key (a trigger); the ring keeps at most the source's `ring` values (D131).
- **One durable result per mutation ID** (IN-01).
- **One delivery row per submission and port owner**, which makes the outbox idempotent (IN-12). A trigger refuses any change to a delivery once its state is terminal.
- **Event order:** the home-wide cursor gives total order, and the per-artifact sequence gives each artifact's order (IN-08).
- **Leases:** each port has exactly one lease holder.
- **Capabilities:** the ledger holds no secret. A token's secret, a session's cookie and its CSRF token are stored only as SHA-256 hashes. A trigger refuses any change to a revoked token and any change to a token's secret, artifact, grant, expiry, version or shell origin, and a default token can't expire (D97, D98).

`snapshot_json` is the canonical answer document, stored in its RFC 8785 (JCS) form: the submission's ID and time, artifact, version and number, view, viewer, channel, policy, epoch and previous submission, stale-view flag, the draft's revision and fields (value, label, required, sensitive), the artifact state's revision and fields, orphans, the action runs started in the view with their state at submit time (at most 100, D130) and the signals raised in the view (the newest 100 within 1 MiB of payloads, with `signalsOmitted` counting the rest and `signalsCompacted` set when compaction may have removed some). A snapshot holds at most 40 Mi characters (`MOSTRA_FIELD_TOO_LARGE` otherwise), so its results always fit one protocol message. Its digest is the SHA-256 of that text. Submissions are write-once: triggers refuse any `UPDATE` or `DELETE` of `submission` (invariant 4), and an insert over an existing submission, which `INSERT OR REPLACE` would otherwise turn into a silent delete. Versions are write-once the same way: triggers refuse any `UPDATE` of `version` and an insert over one (invariant 3); deliveries and tokens refuse an insert over an existing row too, deliveries are never deleted, and `event` is append-only.

## 4. Event catalog

Every durable event has `{ cursor, artifactId, seq, type, at, actor: { kind: "viewer" | "agent" | "host" | "mostra", id? }, causation?: { runId?, mutationId?, submissionId? }, payload }`.

| Type | Payload (summary) |
|---|---|
| `artifact.created` | title, family |
| `version.published` | versionId, number, forced codes |
| `view.opened` / `view.closed` | viewId, versionId, viewer |
| `draft.changed` | viewerId, epoch, revision, changes (`{ id, value }`, `{ id, deleted }`, or `{ id, sensitive: true }` without the value) |
| `draft.conflict` | viewerId, epoch, revision, base, field IDs with their revisions |
| `state.changed` | revision, changes as for `draft.changed` (D63) |
| `state.conflict` | revision, base, field IDs with their revisions |
| `submission.created` | submissionId, versionId, version, viewId, viewerId, channel, epoch, staleView, digest |
| `submission.retrying` | submissionId, deliveryId, owner, attempts, reason: once per delivery, when its host is away or its first attempt failed, so the viewer sees "Pending delivery" (IN-13) |
| `submission.delivered` / `submission.rejected` / `submission.undeliverable` | submissionId, deliveryId, owner, attempts, reason |
| `signal.raised` | name, payload, source (`shell`, `artifact`, `action`), viewId; every submission raises `submit` (D106); from server code, the `viewerId` whose call raised it instead of a view, and a page sees it only when that is its own viewer (D136) |
| `review.thread.created` / `review.comment.added` / `review.thread.resolved` / `review.thread.reopened` | thread and comment IDs, anchor summary |
| `action.started` / `action.succeeded` / `action.failed` / `action.cancelled` | runId, action, reason |
| `host.<name>` | `data`, the payload server code emitted (AC-05), and the `viewerId` whose call emitted it; for hosts, never shown to pages (D136) |
| `worker.crashed` | versionId, kind (`crash`, `oom`, `hang`), cause, backoffMs, parked (D133); pages get it without `cause`, which quotes the server code's output (D136) |
| `share.started` / `share.stopped` | shareId, via, hostname; `share.started` the artifact's external origin, `share.stopped` its reason (`stopped`, `expired`, `revoked`, `tunnel`, `restart`) (D158) |
| `token.revoked` | tokenId |

These are ephemeral and never stored (D47, D63): presence, live updates, action progress and log lines (the log is stored on the run, not as events), terminal output and save acknowledgments.

**Compaction** (D47) is opt-in (`mostra gc --compact-events --before <cursor>`, WP-10). It replaces an artifact's events before a cursor, in one transaction, with one `artifact.compacted` event at the last replaced cursor and sequence, so neither ever moves back. Its payload summarizes them: `from` and `through` (the first and last cursors covered; an earlier summary in the range folds in, keeping its `from`), `removed`, counts per type and the latest version published. A filtered reader still receives it, and a reader who receives it continues after it. A reader whose cursor lies inside a summary's range (`from` ≤ cursor < `through`) had events that are gone: reads answer `MOSTRA_HOST_CURSOR_COMPACTED`, and a live subscription receives the summary with that diagnostic and continues after it, never a silent gap.

## 5. Values and limits

- **Field values** are JSON. Binary data goes to blobs, referenced as `{ "$blob": sha256, "type": mime }`.
- **Limits.** 1 MiB per field value and 16 MiB per document (D62 class, configurable). Exceeding either is `MOSTRA_FIELD_TOO_LARGE`, never truncation.
- **Live values.** 4 MiB each. Ring buffers are bounded by count: the source's `ring`, 1024 for pushed keys, at most 100,000 (D131).
- **Action runs.** Arguments and stored results 16 MiB each of serialized JSON (D131).
- **Secrets.** Names of at most 128 characters; values of 1 byte to 64 KiB, files only, never in the ledger (D131).
- **Run logs** are capped at 1 MB with a truncation marker (D47).

## 6. Migrations

The ledger carries `schema_migration`. A new ledger is built in a temporary file with `schema_migration` and `ledger_lock`, then linked into place without replacing anything, so an existing `ledger.sqlite` is always a complete database and Mostra never recreates an empty ledger over one. A newer runtime migrates forward in one transaction at start-up, after `PRAGMA quick_check` passes and a file-level backup (`ledger.sqlite.bak-<from>-<to>`, written with `VACUUM INTO`, which SQLite fsyncs under `synchronous=FULL`; copying the file would drop the supervisor's lock). An older runtime refuses a newer ledger with `MOSTRA_HOME_TOO_NEW`, naming the schema version and the runtime version that wrote it. A file that isn't a Mostra ledger, or can't be read, is `MOSTRA_HOME_LEDGER_UNREADABLE`. `child.start_time` is an opaque identity of a process start (the boot plus `/proc/<pid>/stat` start ticks on Linux, the boot plus `ps -o lstart` seconds on macOS). Version directories, blobs and source snapshots are immutable, so they never migrate.

## 7. Remote server and team data

The plan update of 2026-10-16 adds stored data that later packages design. Each is a *Deferred decision* for the package named, which adds its tables, columns and events here additively, without weakening a constraint above.
- **WP-28** (D116, D117): hosted homes on a remote server, the mapping from remote accounts to homes as the runtime sees it, the relay's run states (additive to `action_run`, D124), sync cursors between an owner's instance and a remote server, and retention on the server. The operating layer's own data (accounts, billing, metering storage) lives outside this repository (D116).
- **WP-31** (D121): expected respondents and their roster per artifact or share, the roster-complete event, and the attribution of artifact-scoped fields. Presence, cursors and selections stay ephemeral and are never stored (§4, D47).
- **WP-20** (D121): the mention event raised by an `@mention` in a review comment (CO-06).
