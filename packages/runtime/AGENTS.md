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
- **Every child goes through the process manager (RT-09, RT-10).** `ProcessManager.spawn` starts
  it in a group of its own (a process group on POSIX, a Job Object on Windows, `platform/launch.ts`)
  and records it in `child`, by PID and start time (creation time on Windows), before it may run.
  A child that starts a program in its own session (a PTY) adopts it with `child/adopt`; on
  Windows every descendant is already in the child's job.
- **Children die with their supervisor.** A Node child connects with `connectToSupervisor`, which
  ends its process group when the IPC channel disconnects. Packages that can't import this one
  (`@mostra/worker`, `@mostra/pty-host`) implement the same rule. On Windows the child's gate
  holds its Job Object with kill-on-close and ends it when its lifeline (descriptor 3) closes, so
  the child and its descendants end with the supervisor whatever the child does.
- **The platform layer owns every operating-system difference (WP-W1, RT-10).** `platform` is the
  one module that reads `process.platform`; everything else asks it (`WINDOWS`, `OS`) or calls its
  functions: home defaults, owner-only directories (mode 0700, or an owner-only access list on
  Windows), the control endpoint (a Unix socket, or the helper's owner-only named pipe on
  Windows), process identity, launching, ending and reaping children, renames that ride out
  Windows sharing violations, syncing, directory links (junctions on Windows) and sealing. A
  test (`platform-layer.test.ts`) fails on any other module that reads `process.platform`.
  Windows work goes through `mostra-win.exe` (`crates/mostra-win`), found by `helperPath()`.
- **Windows runs only behind `MOSTRA_DEV_WINDOWS=1` until WP-W3 (D146).** Only Mostra's CI legs
  set it; without it Windows fails closed like every unsupported platform.
- **The platform gate runs first (D35, RT-07).** No entry point touches the home before
  `checkPlatform` passes, and nothing platform-specific loads before it: native modules
  (`better-sqlite3`, `oxc-parser`) load on first use through `createRequire`, which a boundary rule
  enforces.
- **The supervisor never runs artifact code (RT-02).** It reads manifests by parsing (Oxc, YAML)
  and builds in a builder child per build (`builder/child/`, the only code that may import Vite and
  its plugins). The RT-02 audit (`test/integration/audit.test.ts`) records every module the
  supervisor loads.
- **A child runs only once it is recorded (issue #7).** `ProcessManager.spawn` starts every child
  behind a gate: on POSIX a `/bin/sh` that `exec`s the command after the supervisor wrote its
  `child` row; on Windows `mostra-win gate`, which creates the command suspended in its Job
  Object, reports its PID and creation time, and resumes it on "go".
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
- **One channel policy per view (D108).** The ticket resolves the policy once (`gateway/controls.ts`:
  a registered `trustedControls` port, else the home's `submitChannels`, else both) and stores it
  on the view; the submit transaction and the artifact's writes to `review.<set>.choice` check that
  record, before anything else, including a repeat of an earlier submit. A port that fails or
  doesn't answer within 5 s narrows the view to the shell channel; it never widens it.
- **A session's person is decided once, at the link's exchange (D143 item 2).** A link minted
  with a viewer acts for it; otherwise `gateway/identity.ts` asks a registered `identity` port
  (headers without `cookie` and `x-mostra-*`) and the session row keeps the answer
  (`session.viewer_id`), which the frame's session inherits through its ticket. A host that took
  identity over and fails, times out, answers nonsense or is expected but away refuses the
  exchange (503 `MOSTRA_HOST_IDENTITY_UNAVAILABLE`); nobody silently becomes the local user.
  The ports the instance calls are `SUPPORTED_PORTS` in `instance/index.ts`.
- **Orphans are derived, never stored (D109).** A field is an orphan of a view when the view's
  version's `fields` coverage (`builder/coverage.ts`) doesn't cover it; nothing moves or drops a
  field. Coverage that can't be known is open: a version never orphans an answer by a guess.
- **Artifact server code runs only in workers (RT-02, RT-03, D129).** `workers/pool.ts` keeps one
  worker per version with server code, started through a `WorkerLauncher` that gets a version
  reference, never a path; `workers/launcher.ts` holds the local launcher (the process manager,
  `artifactEnvironment`, the heap limit, the channel on descriptor 4) and the socket launcher
  tests use. A replacement starts only once a stopping worker has exited. A worker's crash, OOM
  or hang ends it alone: the pool restarts it with backoff, parks it after more than five crashes
  in ten minutes, and appends `worker.crashed`; a publish clears the park for calls (`pool.clear`)
  and live producers (`live.unpark`) alike. Server code's packages run from the layout the version
  was built against (D135): the local launcher asks `Dependencies.runtimeModules` for it before a
  worker starts (installing a removed layout from the store, or a pinned one when the warm set
  moved on) and passes it as `--modules`.
- **A run is recorded before it starts, and ends once (AC-02, AC-03, D130).** `actions` inserts the
  run (`interaction/runs.ts`) before a worker sees it; keys and client keys join existing runs; a
  run cut off by a crash or a stop ends `failed` with reason `interrupted` and is never retried
  (D24). A finished run and its result batches never change, and no insert replaces them
  (triggers). A page sees a run only through a link that may run its function, and a run without
  a key only as its own viewer: `runVisible` in `interaction` decides it, before anything is
  attached to the page, and for every `action.*` event on its stream. A function its version
  doesn't have, and arguments `checkArgumentFrames` refuses, are refused before a run is recorded
  or a worker starts (D136). Server code's signals and `host.*` events carry the calling viewer;
  pages see only their own viewer's signals and never a `host.*` event (`visibleTo`).
- **Secrets reach server code only as answers on its channel (D44, D124, D131).** `secrets` keeps
  values as 0600 files, never in the ledger; `secret()` asks the host's port, then the artifact's
  store, then the home's. Every value handed out is registered with the redactor, and logs, run
  logs, run progress, errors (live sources' too), events, run results, action-written state and
  live values pass through it. Serializer batches (results, live values) go through
  `redactFrames`, which redacts values rather than text (bytes included, `$` escapes kept); other
  new output of server code goes through `redactValue`. A multi-line secret is protected line by
  line too, since child output is kept a line at a time.
- **Live updates and run progress are never events (LL-04, D130).** They travel on the
  `interaction/ephemeral.ts` bus to the pages and polls that asked within the last minute, without
  an `id`; the ledger keeps the latest live value and the ring, and pages read again after a gap.
  What a slow reader hasn't taken is coalesced (`bus.coalesce`): a source's newer value in latest
  mode replaces its older ones, and a run's contiguous deltas merge. Which artifacts have live
  sources is kept in memory (`instance`), so reconciling never scans every artifact.
- **verify never touches the home, and publish never skips it (D41, D138).** A verify run serves
  its build from a sandbox (`verify/sandbox.ts`): a scratch ledger in `cache/verify/runs/<run>/`
  with the real interaction, actions, live and gateway code, its own worker pool and two listeners
  on ports the operating system assigns, reached only with links minted there. Nothing reaches
  the home's drafts, state, events, hosts or deliveries, and the human-facing gateway serves
  published versions only. In the sandbox, a function that didn't opt into `dryRun()` is refused
  before anything is recorded (`MOSTRA_VERIFY_ACTION_SKIPPED`), and documents get the verify
  target as they are served, so verify's build stays byte-identical to what publish promotes.
  Publish gets the verdict cached for its digests (`cache/verify/`) or runs verify, refuses on
  errors, records error codes with `force`, never publishes what didn't build, and records
  `verify: { status, verifyRevision }` on the version (migration 8): only a `pass` is ever a
  regression baseline. Playwright, axe and the type checker run in children (`@mostra/verify`'s
  runner, `typecheck`), never in the supervisor (RT-02's audit covers verify).
- **A dev preview is never a viewer's path (VR-03, VR-08, D140 item 12).** `mostra dev` serves
  unpublished source only from its session's sandbox: listeners on loopback ports the operating
  system picks, a link minted in the session's scratch ledger, the gateway's route table and
  checks in front of the dev server (`gateway/dev.ts` proxies files and the HMR WebSocket, without
  Mostra's cookies), and a dev server that answers only requests carrying the session's secret.
  The home's gateway never proxies to it, no home link opens it, and a non-loopback `--bind`
  refuses it. A session belongs to the connection that started it, keeps a daemon from its idle
  exit, and its directory is removed when it ends and at every start.
- **The shell and every artifact are separate origins (SH-01).** The shell page may be framed by
  nothing and sends `Cross-Origin-Opener-Policy: same-origin`, so no popup of a frame can navigate
  it; an artifact document may be framed only by its shell (D98 items 4 and 7).

## Where things are

`src/index.ts` is the public interface; `etc/runtime.api.md` is its API report. Modules each have
one `index.ts`, and imports between them go only through it (REPO_STANDARDS §3):

| Module | Owns |
|---|---|
| `home` | Platform gate, home and runtime-directory resolution, permissions, the socket name, taking the lock or finding the owner, `instance.json`, the home's settings (`config.json`) |
| `platform` | Every difference between POSIX and Windows (WP-W1): default homes, owner-only directories, the control endpoint (`control.ts`: the Unix socket or the helper's pipe, with its frame protocol), process identity (`identity.ts`), the child gate, Job Objects and reaping (`launch.ts`), file operations (`files.ts`), base environments, and running the Windows helper (`helper.ts`) |
| `ledger` | The SQLite ledger: lock, pragmas, migrations with backup, integrity, error mapping |
| `processes` | Process identity (PID plus start time), the process manager with its gate, reaping, the child side of IPC, the artifact environment children of artifacts get |
| `protocol-server` | The JSON-RPC dispatcher for stdio and the socket, session rules, the session methods |
| `builder` | The `RenderMode` contract and its SPA implementation; `child/` is the builder process (Vite, MDX, Tailwind, the `"use server"` stubs, the scan of actions, live sources, pages and field coverage (`child/fields.ts`, D109), and the confinement of imports to the build's packages); `coverage.ts` matches a version's coverage (`coverageMatcher`), which `readFieldCoverage` in `index.ts` reads back from `registry.json` |
| `deps` | The warm set, the static import scan, lockfiles, working lockfiles and the store index in the ledger, lock layouts in `deps/locks`, the pnpm 10 installer, offline answers, `deps/add`; `child/install.ts` is the install child, which connects to the supervisor and runs pnpm in its process group |
| `publish` | Sources, ignore rules, snapshots (tar.zst), digests and version IDs, manifest extraction, the publish pipeline, the `artifact/*` and `deps/add` methods |
| `registry` | Artifacts, versions and source bindings in the ledger, identity and ID conflicts, the sealed version store, recovery at start |
| `interaction` | Viewers and views, with each view's controls (D108); documents, fields and mutations with per-field compare-and-set (`fields.ts`); the policy in force (`policy.ts`); the submit transaction with its channel check and orphans (`submissions.ts`); the trusted Choose, carry-over and follow; signals; the outbox and draft mirrors (`outbox.ts`); events with filters, compaction and subscriptions; `wait`; results as JSON and Markdown; the `state/*`, `results/get`, `wait` and `events/*` methods |
| `addressing` | The bind (`--bind`, `--url-host`), origins and exact Host allowlists, port leases in `port_lease`, binding a lease and leasing again when its port is taken, the frame-session mode for an origin pair |
| `gateway` | Capability tokens, links, sessions and frame tickets (`capabilities.ts`); the channel policy a ticket resolves (`controls.ts`); the browser protocol's `fields`, `submit`, `signal`, `events` and `events/poll` on artifact origins, and the shell's trusted `submit`, `review/choose`, `follow`, `carry` and its own stream (`browser.ts`), for every revision served; the route table and its checks (`routes.ts`); the HTTP listeners, with the 1 MiB header limit and the cookie-clearing 431 page (`listener.ts`); static files (`serve.ts`); version integrity for served files (`integrity.ts`); the shell and artifact routes and `view/url`, `view/rotate`, `view/revoke` (`index.ts`) |
| `actions` | Plain calls and durable action runs (D54, D130): starting, joining, attaching, cancelling and recovering runs, flushing their progress, log and result batches, the worker bridge for `secret`, `signal`, `emit` and `state` |
| `workers` | The `WorkerLauncher` seam with the local and socket launchers (D124), and the pool: one worker per version, start, ping watchdog, idle eviction, crash kinds, backoff and parking (D129, D133) |
| `secrets` | The home's secret store, the `secrets` port's precedence and `secret/set`, `secret/list`, `secret/delete` (D131) |
| `live` | Live sources (D56): the latest value and ring in the ledger, `live/push`, which producers run (views' interest, host subscriptions, `always`), and their updates |
| `service` | The daemon's idle exit (`idle.ts`) and the per-home login service (`unit.ts`: launchd, systemd, or Task Scheduler with the helper's windowless launcher on Windows) (D133, D151) |
| `gc` | What keeps a version (`REFERENCE_SOURCES`, one named source per rule, checked against every ledger column that names a version by `test/unit/gc.test.ts`), the collection that marks versions in `version_collected` and removes their files, unreferenced snapshots, lock layouts, store packages and verify caches, serialized against publish, verify and installs by the instance's `Gate` (`src/gate.ts`), and `gc/run` (D140 item 14) |
| `dev` | `mostra dev`'s sessions (D140 item 12): the source mirrored into `cache/dev/<session>/root`, the dev server in a builder child (`builder/child/dev.ts`, Vite in middleware mode, answering only with the session's secret), the sandbox the preview is served from (`verify/sandbox.ts` with `dev`), and `dev/start`, `dev/stop` and `dev/notify` |
| `verify` | The pipeline and the verdict cache (`index.ts`), the sandbox a run serves its build from (`sandbox.ts`), the type check in a child (`typecheck.ts`), field-ID lint (`fields.ts`), regressions against the last passing version (`regression.ts`), and the client of the runner child (`runner.ts`) (D138); `artifact/verify` is in `publish` |
| `instance` | The composition root: start-up and stop order only, no policy |

`src/log.ts` is the supervisor's JSON-lines log in `<home>/logs/`. `src/faults.ts` reads
`MOSTRA_TEST_FAULTS` (`<point>:throw|crash|hang`, comma-separated), the fault points tests use to fail
or SIGKILL the instance at a named step (`publish:after-build`, `spawn:before-record`, or `spawn:before-record:<kind>` for one kind of child …), or to
hang a child (`builder:build:hang`: each builder never answers its build, issue #18);
`MOSTRA_TEST_BUILD_TIMEOUT_MS` shortens the 180 s build limit and `MOSTRA_TEST_INSTALL_TIMEOUT_MS`
the 300 s install limit, and `MOSTRA_TEST_CLOCK_OFFSET_MS` moves the gateway's clock forward
(token expiry, session age) without waiting, and `MOSTRA_TEST_PORT_TIMEOUT_MS` shortens the 30 s limit on host port calls; `MOSTRA_TEST_BROWSER_REVISION_NEXT` makes the gateway also serve a newer, test-only browser-protocol revision with today's handlers (VR-10). These are for tests only. `MOSTRA_OFFLINE` (not a
test variable) makes the instance offline: packages resolve only from the home's store.
`MOSTRA_TEST_WORKER_IDLE_MS` shortens workers' idle eviction, `MOSTRA_TEST_WORKER_BACKOFF_MS` their
first restart delay, `MOSTRA_TEST_INTEREST_LEASE_MS` the minute a page's interest in a run or live
source lasts, `MOSTRA_TEST_IDLE_EXIT_MS` the daemon's 30 idle minutes, and
`MOSTRA_TEST_WORKER_HOST` sends every launch to a worker host listening on that socket
(`test/fixtures/worker-host.mjs`, D124). `MOSTRA_WORKER_ENTRY` points at another build of
`@mostra/worker` (default: `worker/dist/main.js`, or its source under `@mostra/source`).
`MOSTRA_VERIFY_ENTRY` points at another build of `@mostra/verify`'s runner (default: `verify/dist/main.js`); `MOSTRA_TEST_VERIFY_TIMEOUT_MS` shortens verify's 120 s, `MOSTRA_TEST_SMOKE_INTERACTIONS` the smoke test's 200 interactions, `MOSTRA_TEST_VERIFY_IDLE_MS` the runner's 10 idle minutes, and `MOSTRA_TEST_UNVERIFIED_PUBLISH` makes publish skip verify's gate, for the suites of other features only: such a version records no verdict and never counts as passing (`testHome` sets it; `verifiedHome` keeps the gate). `MOSTRA_SHELL_DIR` points the gateway at another build of `@mostra/shell` (default:
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
  results, deliveries while a host is away, redelivery after a crash, resumed subscriptions), and
  the versions frozen at every browser-protocol revision against today's gateway and the next
  (`browser-revisions.test.ts`, VR-10), and WP-08's suites: calls, runs, secrets and live sources
  through both launchers (`actions.test.ts`), worker and daemon lifecycles (`lifecycle.test.ts`),
  producers and the secrets port (`producers.test.ts`), and the five D19 seams (`seams.test.ts`),
  and WP-10's `mostra dev` sessions in Chromium (`dev.test.ts`: hot updates, server code, scratch
  submissions, the session's end, its listeners and secrets).
  CI runs them on macOS and
  Linux (`integration` job, D86), split into groups of suites, one machine each:
  `MOSTRA_TEST_GROUP=core|verify|verify-failures` runs one group (`vitest.config.ts`), unset runs
  them all. The groups partition the files by name, so a new suite lands in exactly one; a new
  `verify*` suite joins `verify`.
- `pnpm --filter @mostra/runtime test:integration -- verify audit`: verify through a real daemon
  (`verify.test.ts`: WP-03's fixtures as negatives, a fixture per stage's faults, regressions, the
  gate; `verify-failures.test.ts`: timeout, the smoke budget, no browser, a runner that dies,
  sandboxes left at start) and the RT-02 audit across verify runs. It needs the Chromium headless
  shell `playwright-core` pins (the install command above).
- `pnpm --filter @mostra/runtime test:hygiene`: the hygiene checklist (ARCHITECTURE §10) as
  negative tests against a real gateway, through `test/browser-client.ts`, a cookie-jar HTTP
  client that behaves like a browser (`hygiene` job).
- `pnpm check --job e2e`: capability links in Chromium, Firefox and WebKit
  (`tests/e2e/specs/gateway.spec.ts`), and the client runtime with the shell's trusted controls
  (`client`, `controls`, `versions` and `pages` specs); `node scripts/safari-smoke.ts` opens one in
  real Safari on macOS (external evidence, run by hand).
- `node --conditions=@mostra/source scripts/freeze-browser-revision.ts` freezes a version built at
  the current browser-protocol revision into `test/fixtures/browser-revisions/<revision>/`, once
  per revision; it refuses to overwrite one (D111).
- `node packages/runtime/scripts/prove-seeds.ts --only DP-03` replays a requirement's seeded
  violations: red with the seed, green without it. `--name <text>` narrows them to the seeds whose
  names contain it (`--only VR-06 --name "Opus review"`). `--anchors` runs nothing and checks that
  every seed still finds the text it plants into (the `boundaries` job runs it on every change):
  when a refactor moves an anchor, re-anchor the seed on the same behavior and replay it.

## Gotchas

- Integration tests run `dist/bin.js` and `dist/builder/child/main.js`; rebuild after changing
  `src`, `@mostra/protocol` or `@mostra/react` (builds resolve its `dist`).
- Version directories are read-only; remove a test home with `removeAll` from `test/support.ts`.
- Artifact fixtures live in `test/fixtures/artifacts/`, outside type checking and linting: they
  are what agents write, not this package's code.
- Linux differs from macOS in process listings, signals and `/bin/sh` (`dash`). Run process and
  socket changes on Linux before pushing ([playbook](../../docs/agents/reproduce-on-linux.md)).
- Windows differs in kind (WP-W1): no signals between processes (stop a daemon with
  `mostra/shutdown`, `shutdownDaemon` in `test/support.ts`), no process groups (Job Objects), no
  modes (access lists), files in use can't be removed or renamed, and paths use `\`. Code asks the
  platform layer; tests use `WINDOWS` from `test/support.ts` and give a Windows variant, or say
  why a POSIX check doesn't apply. The Windows legs run the Windows groups
  (`MOSTRA_TEST_GROUP`, `vitest.config.ts`), which partition every integration suite: a new suite
  joins exactly one of them (`windows-groups.test.ts` fails otherwise), with `MOSTRA_DEV_WINDOWS=1`
  and the helper Cargo builds; only GitHub's Windows runners run them ([playbook](../../docs/agents/run-on-windows.md)).
- Keep test sockets under `/tmp` (`tempDir(prefix, true)` in `test/support.ts`): macOS limits
  socket paths to 103 bytes, and its `os.tmpdir()` is long.
- `net.Server.close()` removes the socket file. Close an old listener before binding its
  replacement.
- macOS start times have one-second resolution; compare them only with `startedNoEarlier` and
  `sameBoot` in `processes/identity.ts`. That is enough because XNU reuses a PID only after the
  whole PID range went round (issue #8, VERIFIED_FACTS WP-08).
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
