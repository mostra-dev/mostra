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
- **Packages come only from the warm set and the artifact's lockfile (D95, DP-01 to DP-05).** An
  install runs pnpm 10 (never 11 or later, D94) in an install child through the process manager,
  in the artifact's directory with `artifactEnvironment`, never in the supervisor; the child is
  IPC-connected, so it and its lifecycle scripts end with the supervisor. An artifact's working
  lockfile changes only through `deps/add` or inside the transaction that commits a publish. A lock layout
  links every warm package through its `warm` symlink, so peers resolve to the one warm React; it
  counts only once it carries `.mostra-layout`. Every pin in a lockfile is exact, `lockDigest` is
  part of `envDigest`, and offline requests the store index can't satisfy fail before any child
  starts.
- **Only capability holders use an artifact (D06, D96 to D99, HY-01 to HY-03).** Every HTTP
  route is declared once in `gateway/routes.ts` with its intent, session and scope, and one runner
  applies `@mostra/protocol`'s `checkRequest` (exact Host, request target and headers, exact
  Origin, JSON content type, CSRF), then the rate limit, the origin-bound session and the scope,
  before any handler. Add a route by declaring it there, never by mounting a handler of its own.
  Unbuilt routes answer 501 behind the same checks, so a later package attaches a handler and
  repeats the scope test.
- **The ledger holds no capability secret.** Tokens, session cookies and CSRF tokens are stored
  only as SHA-256 hashes; a token's secret is derived from its ID under `<home>/keys/capability`
  (D97). A revoked token never changes again (a trigger refuses it); rotate in one transaction.
  A token works only at the shell origin it was minted for, and a link that names a version opens
  only that version, assets included (D97 items 9 and 10).
- **Guessing is limited per artifact, at the token check (D97 item 8).** `presentToken` checks
  the limit itself, so concurrent guesses can't slip past it; frame tickets never count.
- **A `requestId` replays only its own request (D100).** Record results with `recordResult` and
  replay with `recordedResult` from `ledger`, keyed by `requestKey(method, params)`, in the
  transaction of the effect; never read or write `request` by hand.
- **Every served file comes from an intact version (FAILURE_MODEL §3).** `gateway/integrity.ts`
  checks a version against its output digest before its first file and again when a file's change
  time differs; serve through it.
- **The gateway binds `127.0.0.1` unless `--bind` says otherwise (D99, HY-02),** never
  remembered. `addressing` leases every port from 20000 to 32767 and binds every lease at start.
- **Viewers reach only published client builds (VR-03).** Artifact origins serve files only from
  a version's `client/` directory, through `serve.ts`, which refuses anything whose real path
  leaves that root. Serving a version starts no process (RT-05).
- **Every interaction change is one transaction with its events (IN-08, ARCHITECTURE §6).**
  Mutations, submits, signals, deliveries and views go through `interaction`, which appends their
  events with `appendEvent` inside the same `Ledger.write`; never append an event outside the
  transaction of its change. Readers learn of commits through `Ledger.onCommit`, never by polling.
- **Submissions are immutable and made only from the ledger (IN-05, IN-06).** The submit
  transaction reads the canonical draft and state; nothing a page sends becomes a submission. A
  trigger refuses any `UPDATE` or `DELETE` of `submission`, and a terminal `delivery` never
  changes. The submissions port is called only from `interaction/outbox.ts`, with an envelope built
  from the submission row; drafts leave only through `port/drafts.mirror`, as `kind: "draft"`.
- **A submission is durable before any delivery (IN-12).** Deliveries are rows in the submit
  transaction; the outbox only reads them, delivers one at a time per host in submission order,
  and records each answer. A crash between a host's answer and its record redelivers the same
  `deliveryId`.
- **Mostra wakes nobody (IN-09, D10).** A signal is one `signal.raised` event. No code path calls a
  host or notifies anyone because of a signal; hosts subscribe and decide.
- **Pages see only their own viewer's draft (D104).** `pageEvents` filters every stream and poll;
  a view belongs to one artifact and one viewer, checked on every request that names it.
- **The shell and every artifact are separate origins (SH-01).** The shell page may be framed by
  nothing and sends `Cross-Origin-Opener-Policy: same-origin`, so no popup of a frame can navigate
  it; an artifact document may be framed only by its shell (D98 items 4 and 7).

## Where things are

`src/index.ts` is the public interface; `etc/runtime.api.md` is its API report. Modules each have
one `index.ts`, and imports between them go only through it (REPO_STANDARDS §3):

| Module | Owns |
|---|---|
| `home` | Platform gate, home and runtime-directory resolution, permissions, the socket name, taking the lock or finding the owner, `instance.json`, the home's settings (`config.json`) |
| `ledger` | The SQLite ledger: lock, pragmas, migrations with backup, integrity, error mapping |
| `processes` | Process identity (PID plus start time), the process manager with its gate, reaping, the child side of IPC, the artifact environment children of artifacts get |
| `protocol-server` | The JSON-RPC dispatcher for stdio and the socket, session rules, the session methods |
| `builder` | The `RenderMode` contract and its SPA implementation; `child/` is the builder process (Vite, MDX, Tailwind, the `"use server"` stubs, the scan of actions, live sources and pages, and the confinement of imports to the build's packages) |
| `deps` | The warm set, the static import scan, lockfiles, working lockfiles and the store index in the ledger, lock layouts in `deps/locks`, the pnpm 10 installer, offline answers, `deps/add`; `child/install.ts` is the install child, which connects to the supervisor and runs pnpm in its process group |
| `publish` | Sources, ignore rules, snapshots (tar.zst), digests and version IDs, manifest extraction, the publish pipeline, the `artifact/*` and `deps/add` methods |
| `registry` | Artifacts, versions and source bindings in the ledger, identity and ID conflicts, the sealed version store, recovery at start |
| `interaction` | Viewers and views; documents, fields and mutations with per-field compare-and-set (`fields.ts`); the policy in force (`policy.ts`); the submit transaction (`submissions.ts`); signals; the outbox and draft mirrors (`outbox.ts`); events with filters, compaction and subscriptions; `wait`; results as JSON and Markdown; the `state/*`, `results/get`, `wait` and `events/*` methods |
| `addressing` | The bind (`--bind`, `--url-host`), origins and exact Host allowlists, port leases in `port_lease`, binding a lease and leasing again when its port is taken, the frame-session mode for an origin pair |
| `gateway` | Capability tokens, links, sessions and frame tickets (`capabilities.ts`); the browser protocol's `fields`, `submit`, `signal`, `events` and `events/poll` (`browser.ts`); the route table and its checks (`routes.ts`); the HTTP listeners, with the 1 MiB header limit and the cookie-clearing 431 page (`listener.ts`); static files (`serve.ts`); version integrity for served files (`integrity.ts`); the shell and artifact routes and `view/url`, `view/rotate`, `view/revoke` (`index.ts`) |
| `instance` | The composition root: start-up and stop order only, no policy |

`src/log.ts` is the supervisor's JSON-lines log in `<home>/logs/`. `src/faults.ts` reads
`MOSTRA_TEST_FAULTS` (`<point>:throw|crash`, comma-separated), the fault points tests use to fail
or SIGKILL the instance at a named step (`publish:after-build`, `spawn:before-record` …);
`MOSTRA_TEST_BUILD_TIMEOUT_MS` shortens the 180 s build limit and `MOSTRA_TEST_INSTALL_TIMEOUT_MS`
the 300 s install limit, and `MOSTRA_TEST_CLOCK_OFFSET_MS` moves the gateway's clock forward
(token expiry, session age) without waiting, and `MOSTRA_TEST_PORT_TIMEOUT_MS` shortens the 30 s limit on host port calls. These are for tests only. `MOSTRA_OFFLINE` (not a
test variable) makes the instance offline: packages resolve only from the home's store.
`MOSTRA_SHELL_DIR` points the gateway at another build of `@mostra/shell` (default:
`shell/dist` beside the runtime package); without one the shell's pages answer
`MOSTRA_ENV_SHELL_MISSING` and the instance still starts.

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
  faults at every publish step, the RT-02 module audit, rendering versions in Chromium
  (`pnpm --filter @mostra/runtime exec playwright install --only-shell chromium` once), and
  on-demand installs against the local registry in `test/registry.ts` (`deps.test.ts`), and the
  gateway through a real daemon (`gateway.test.ts`: serving with no process, route
  enumeration, restarts, a week of simulated time, binds, leases), and the interaction ledger through
  a daemon, real pages and hosts on their own connections (`interaction.test.ts`: conflicts, waits,
  results, deliveries while a host is away, redelivery after a crash, resumed subscriptions). CI runs them on macOS and
  Linux (`integration` job, D86).
- `pnpm --filter @mostra/runtime test:hygiene`: the hygiene checklist (ARCHITECTURE §10) as
  negative tests against a real gateway, through `test/browser-client.ts`, a cookie-jar HTTP
  client that behaves like a browser (`hygiene` job).
- `pnpm check --job e2e`: capability links in Chromium, Firefox and WebKit
  (`tests/e2e/specs/gateway.spec.ts`); `node scripts/safari-smoke.ts` opens one in real Safari on
  macOS (external evidence, run by hand).
- `node packages/runtime/scripts/prove-seeds.ts --only DP-03` replays a requirement's seeded
  violations: red with the seed, green without it.

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
- Tests never reach the real npm registry: start `startRegistry(FIXTURE_PACKAGES)` from
  `test/registry.ts` and pass its URL as `npm_config_registry`, with a temporary `HOME` so no
  user `.npmrc` applies.
- pnpm 10 reads the release age's exemptions only from the install project's
  `pnpm-workspace.yaml`, which the installer writes; `--ignore-workspace` would silently drop them
  (VERIFIED_FACTS, WP-04).
