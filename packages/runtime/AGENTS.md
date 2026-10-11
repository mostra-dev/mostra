# @mostra/runtime

The supervisor that owns a Mostra home: its ledger, its control socket, the host protocol server,
every child process, and the artifacts and versions published into it. Audience: the runtime bundle. `mostra-runtime host|daemon` (`src/bin.ts`) is
the bundle's entry point (D85); it never runs artifact code (RT-02).

## Invariants it owns

- **One owner per home (D81, RT-06).** The home's owner holds the ledger's exclusive SQLite lock,
  taken before anything else. The socket and `instance.json` only help others find the owner;
  never use either as a lock.
- **The ledger has one writer (D58, D71).** Only `ledger` opens `store/ledger.sqlite`, and nothing
  else in the process opens that file: POSIX drops the lock when any descriptor for it closes.
  Every write is one `Ledger.write` transaction, durable before it returns, and fails closed with
  `MOSTRA_HOME_GONE` when the file was removed.
- **Migrations only move forward.** Append a migration to `src/ledger/migrations.ts` and never edit
  a released one. Opening backs the ledger up first; a newer ledger is `MOSTRA_HOME_TOO_NEW`.
- **Every child goes through the process manager (RT-09).** `ProcessManager.spawn` starts it as
  the leader of its own process group and records it in `child` before anyone relies on it. A
  child that starts a program in its own session (a PTY) adopts it with `child/adopt`.
- **Children die with their supervisor.** A Node child connects with `connectToSupervisor`, which
  ends its process group when the IPC channel disconnects. Packages that can't import this one
  (`@mostra/worker`, `@mostra/pty-host`) implement the same rule.
- **The platform gate runs first (D35, RT-07).** No entry point touches the home before
  `checkPlatform` passes, and nothing platform-specific loads before it: native modules
  (`better-sqlite3`, `oxc-parser`) load on first use through `createRequire`, which a boundary rule
  enforces.
- **The supervisor never runs artifact code (RT-02).** It reads manifests by parsing (Oxc, YAML)
  and builds in a builder child per build (`builder/child/`, the only code that may import Vite and
  its plugins). The RT-02 audit (`test/integration/audit.test.ts`) records every module the
  supervisor loads.
- **A child runs only once it is recorded (issue #7).** `ProcessManager.spawn` starts every child
  behind a `/bin/sh` gate that `exec`s the command after the supervisor wrote its `child` row.
- **Versions are immutable and appear atomically (VR-01, VR-02).** A version directory is built in
  `cache/staging`, sealed read-only, renamed into `versions/`, and becomes visible only when its
  ledger row commits; a failed publish removes what it placed, and the next start removes anything
  without a row. `version` rows have an UPDATE-refusing trigger; `event` is append-only.
- **No secret reaches a log or a report.** Every string the log writes passes through the
  instance's `Redactor`, and child output is redacted before it is kept. Pass the secrets a child
  receives in `SpawnSpec.redact`; variables named like secrets are redacted on their own.
- **Hosts reach the instance only through the protocol (D59).** Methods are defined in
  `@mostra/protocol` and served through `ProtocolServer`; port calls go only to the connection that
  registered the port.

## Where things are

`src/index.ts` is the public interface; `etc/runtime.api.md` is its API report. Modules each have
one `index.ts`, and imports between them go only through it (REPO_STANDARDS §3):

| Module | Owns |
|---|---|
| `home` | Platform gate, home and runtime-directory resolution, permissions, the socket name, taking the lock or finding the owner, `instance.json` |
| `ledger` | The SQLite ledger: lock, pragmas, migrations with backup, integrity, error mapping |
| `processes` | Process identity (PID plus start time), the process manager with its gate, reaping, the child side of IPC |
| `protocol-server` | The JSON-RPC dispatcher for stdio and the socket, session rules, the session methods |
| `builder` | The `RenderMode` contract and its SPA implementation; the warm set; `child/` is the builder process (Vite, MDX, Tailwind, the `"use server"` stubs, the scan of actions, live sources and pages) |
| `publish` | Sources, ignore rules, snapshots (tar.zst), digests and version IDs, manifest extraction, the publish pipeline, the `artifact/*` methods |
| `registry` | Artifacts, versions and source bindings in the ledger, identity and ID conflicts, the sealed version store, recovery at start |
| `interaction` | The event log's append path (WP-06 adds drafts, submissions and reading) |
| `instance` | The composition root: start-up and stop order only, no policy |

`src/log.ts` is the supervisor's JSON-lines log in `<home>/logs/`. `src/faults.ts` reads
`MOSTRA_TEST_FAULTS` (`<point>:throw|crash`, comma-separated), the fault points tests use to fail
or SIGKILL the instance at a named step (`publish:after-build`, `spawn:before-record` …);
`MOSTRA_TEST_BUILD_TIMEOUT_MS` shortens the 180 s build limit. Both are for tests only.

To serve a new protocol method, define it with `pnpm gen protocol-method` in `@mostra/protocol`
([playbook](../../docs/agents/add-protocol-method.md)), implement it in the module that owns its
behavior, and pass a `handler(definition, fn)` to the `ProtocolServer` that `instance` builds.
`handler` lives in `protocol-server/server.ts`; export it from the module's `index.ts` when the
first module outside `protocol-server` needs it.

## Tests to run

- `pnpm --filter @mostra/runtime test`: unit tests in-process (`test/unit`).
- `pnpm --filter @mostra/runtime build && pnpm --filter @mostra/runtime test:integration`: the
  built binary as real processes (`test/integration`): the protocol suite over stdio and the
  socket, racing starters, stale sockets, reaping after SIGKILL, the platform gate, publishing,
  faults at every publish step, the RT-02 module audit, and rendering versions in Chromium
  (`pnpm --filter @mostra/runtime exec playwright install --only-shell chromium` once). CI runs
  them on macOS and Linux (`integration` job, D86).

## Gotchas

- Integration tests run `dist/bin.js` and `dist/builder/child/main.js`; rebuild after changing
  `src`, `@mostra/protocol` or `@mostra/react` (builds resolve its `dist`).
- Version directories are read-only; remove a test home with `removeAll` from `test/support.ts`.
- Artifact fixtures live in `test/fixtures/artifacts/`, outside type checking and linting: they
  are what agents write, not this package's code.
- Linux differs from macOS in process listings, signals and `/bin/sh` (`dash`). Run process and
  socket changes on Linux before pushing ([playbook](../../docs/agents/reproduce-on-linux.md)).
- Keep test sockets under `/tmp` (`tempDir(prefix, true)` in `test/support.ts`): macOS limits
  socket paths to 103 bytes, and its `os.tmpdir()` is long.
- `net.Server.close()` removes the socket file. Close an old listener before binding its
  replacement.
- macOS start times have one-second resolution; compare them only with `startedNoEarlier` and
  `sameBoot` in `processes/identity.ts`.
- A killed process can linger as a zombie until init reaps it. Tests wait for it with
  `eventually`, never with a single check.
- Keep a strong reference to an open better-sqlite3 `Database`: garbage collection closes it and
  drops the home's lock.
