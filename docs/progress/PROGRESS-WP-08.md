# WP-08 progress: workers, actions and live data

**Status:** Candidate, awaiting Mirza's acceptance. The report is finalized after acceptance
(work-packages/README.md §4).

## Baseline

| | |
|---|---|
| Branch | `wp/08-workers-actions`, created from `origin/main` |
| Starting `HEAD` | `b0da907` (`origin/main` at session start, 2026-10-16: "docs(design): the plan update of 2026-10-16 (D116 to D128, WP-28 to WP-32) (#23)") |
| `git status` | clean |
| `pnpm check` | uncached (`TURBO_FORCE=true`, 12 min 9 s, macOS arm64): every job green except `e2e`, where 5 Firefox tests timed out while every job ran in parallel (`client.spec.ts` IN-02 and IN-03, `controls.spec.ts` Claude review finding 6); `pnpm check --job e2e` alone then passed (309 s). Load-dependent, recorded as a baseline failure, not caused by this package |
| Predecessors | WP-06 and WP-07 done ([PROGRESS-WP-06](PROGRESS-WP-06.md), [PROGRESS-WP-07](PROGRESS-WP-07.md) on `origin/main`); no `RECOVERY-WP-08-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, macOS 26.2 arm64 |
| Pull request | [#24](https://github.com/mostra-dev/mostra/pull/24) (draft) |
| `pnpm check` at the candidate | uncached (`TURBO_FORCE=true`), every job green: format-lint, types, unit, integration, hygiene, e2e, build, boundaries, api, licenses, rust, docs, commits (about 14 min on macOS arm64; the browsers now run after the other task jobs, REPO_STANDARDS §5) |
| Open issues for this package | [#8](https://github.com/mostra-dev/mostra/issues/8) (macOS start-time resolution, "to fix in WP-08"): closed by D134 with evidence |

## What was built

- **`@mostra/protocol`:**
  - the server-function serializer (`serializer.ts`): React's documented Server Function types plus `AsyncIterable` results, with identity and cycles, streamed promises and iterables, located `MOSTRA_ACTION_UNSERIALIZABLE` errors, and a conformance suite that runs the same cases through React's own codec (`react-server-dom-parcel` 19.3.0, test-only);
  - the browser protocol's `call`, `runs`, `runs/attach`, `runs/{id}/cancel` and `live` payloads, ephemeral `run` and `live` messages, `FrameTicket.serverParked`, all additive to `2026-10-15` (D130);
  - the worker channel (`worker.ts`, `WORKER_CHANNEL_REVISION` `2026-10-16`), the host methods `secret/set|list|delete`, `live/push`, `port/secrets.get`, and `instance/status`'s `workers` and `idleExitAt`;
  - 13 diagnostics with their pages (`MOSTRA_ACTION_*`, `MOSTRA_RUNTIME_WORKER_*`, `MOSTRA_SECRET_MISSING`, `MOSTRA_LIVE_*`, `MOSTRA_ENV_SERVICE_FAILED`).
- **`@mostra/server`** (new): `dryRun`, `progress`, `log`, synchronous `secret`, `signal`, `emit`, `viewer`, `abortSignal`, `state` and `defineLive`, over an `AsyncLocalStorage` context per call (D19 seam 3).
- **`@mostra/worker`** (new): the worker process: a channel thread that owns the socket and answers the watchdog and synchronous secret reads while the main thread runs artifact code; loads a version's server bundle after checking its digest, runs calls, runs and live producers (`load`, `refresh`, `watch` with a polling fallback, `stream`).
- **`@mostra/runtime`:**
  - `workers`: the `WorkerLauncher` seam with the local launcher (process manager, artifact environment, heap limit, channel on descriptor 4) and a socket launcher (D124); the pool: one worker per version, ping watchdog, idle eviction, crash kinds (crash, OOM, hang), backoff and parking (D129, D133);
  - `actions`: plain calls (NDJSON) and durable runs (recorded before they start, keys, client keys, attach, cancel, `interrupted` on a crash, never retried; 1 MB logs; 16 MiB results), the worker bridge for secrets, signals, host events and state;
  - `secrets`: the home's owner-only store, the port's precedence, redaction of every value handed out (D131);
  - `live`: latest values and rings in the ledger, `live/push`, producers by interest, host subscription or `always`, ephemeral delivery (LL-04);
  - `service`: the daemon's idle exit and `mostra-runtime service install|uninstall|status` (launchd, systemd), `--always-on` (D133);
  - migration 7 (`action_run`, `action_run_batch`, `live_value`, `live_ring`); the ephemeral bus on the event stream and long poll; the gateway's handlers behind WP-05's declared routes and action scopes; artifact listeners that bind when used (D132); the submission snapshot's `actions`; worker entries through `RenderMode.serverEntry`.
- **`@mostra/react`:** `useAction` and `useLive` on the store's `ServerClient`, server references that call through the runtime, the generated `LiveSources` declaration, `"use client"` entries (D19 seam 4).
- **`@mostra/shell`:** the notice "This artifact's server code keeps crashing" for a parked worker.
- **Docs:** D129 to D134 (M22), INTERFACES §2.3, §2.4, §4, §6, §7, DATA_MODEL §3 to §5, FAILURE_MODEL §2 and §6, REPO_STANDARDS §3, VERIFIED_FACTS for WP-08, follow-ups in the WP-09, WP-10, WP-13 and WP-28 specifications, `AGENTS.md` of `runtime`, `react`, `server` and `worker`.

## Decisions taken in the package

M22 delegated all twelve questions (2026-10-16T16:59Z, `<ITU/>`): **D129** workers, their channel and launcher, the synchronous `secret()`; **D130** calls, runs and live data on the browser protocol, run states with `waiting` reserved, partial results, re-attaching by key, results' `actions`; **D131** limits and secrets; **D132** artifact listeners bind when used (amends D99); **D133** the daemon's idle exit, the login service, parking and the shell's notice; **D134** issue #8 closed with XNU's PID allocation as evidence.

## Evidence

Every check runs through the real interfaces: a real `mostra-runtime daemon`, its gateway and real worker processes (`packages/runtime/test/integration`, with the action suite run twice, once through the local launcher and once through a worker host started on its own over a socket, D124), pages in Chromium, Firefox and WebKit through the real shell and gateway (`tests/e2e/specs/actions.spec.ts`, the J3 inbox), the hooks in a real React DOM in Chromium (`packages/react/test/browser`), and the worker and serializer against their real peers (`packages/worker/test`, `packages/protocol/test`, the serializer beside React's own codec). Every row's checks also ran with a seeded violation (`node packages/runtime/scripts/prove-seeds.ts --only <ID>`): 27 seeds for WP-08 (19 for the requirements, 3 more for AC-06 and the environment, 5 for this package's own review fixes), each red when planted and green when restored; the line-splitter fix was seeded by hand (its regression test took 1.6 s on the old code against a 500 ms bound, and 20 ms on the new).

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| RT-03 | verified | A version's first call starts its worker (none before; `instance/status` lists it), one worker per version (two calls, one PID; a sibling artifact gets its own); a worker idle past its limit is evicted and the next call starts a new PID, and one with a run in flight is kept whatever the idle time; after each crash the next start waits 100, 200, 400, 800, 1600 ms (test base; 1 s doubling to 60 s by default), a sixth crash in ten minutes parks the version (503 `MOSTRA_RUNTIME_WORKER_PARKED`, `worker.crashed` with `parked: true`, the shell's notice through `FrameTicket.serverParked`), and a publish clears it; a version without server code starts no worker (RT-05 kept green) | `pnpm --filter @mostra/runtime test:integration -- lifecycle actions` | pass; seeds (never evicted; never parked) red, then green |
| RT-04 | verified | A crash, an out-of-memory (96 MiB heap) and a busy loop (2 s watchdog) in one artifact, each while a sibling artifact's worker runs a 15 s run: the sibling keeps its PID and answers, the gateway serves the shell, the run ends `failed`/`interrupted` with `MOSTRA_ACTION_INTERRUPTED` naming the cause ("exited with code 1: … crashed on purpose", "ran out of memory (heap limit 96 MiB)", "event loop was blocked for 2 s (watchdog limit 2 s)"), `worker.crashed` records the kind, and the next call starts a fresh worker; a stopped process (SIGSTOP) that answers nothing is stopped after three silent watchdog periods, never after one; on Linux a GC stall near the heap limit is named out of memory | as above; Linux in `node:24.12.0-bookworm` (`docs/agents/reproduce-on-linux.md`, 3 runs) | pass; seeds (no watchdog kill; stop after one missed ping) red, then green |
| RT-08 | validated | The daemon exits 0 after its idle time with nothing to do, and stays while a run is in flight; `--always-on` never exits for idleness, nor does a daemon whose home has a login service installed, whoever started it; `instance/status` reports `idleExitAt`; workers run with `--max-old-space-size` from the manifest's `limits` (seen in `ps`) and the 10 s watchdog (2 s in the fixture); the artifact's leased port is the same after a restart; `mostra-runtime service install|uninstall|status --no-start` writes and removes a launchd LaunchAgent (`plutil -lint` passes) on macOS and a systemd user unit on Linux that run `daemon --always-on --home <home>` with no secret | as above (`lifecycle.test.ts` › the daemon's lifecycle) | pass; seeds (exits with a run in flight; unit without `--always-on`; a service doesn't keep a hand-started daemon; no heap limit) red, then green. Boundary: the service manager itself (`launchctl bootstrap`, `systemctl --user enable --now`) wasn't run, so no login service was installed on this machine or in CI |
| AC-01 | verified | An action reads a file of its own choosing, spawns a process (`/bin/echo`) and fetches from a local HTTP server, with nothing in Mostra in the way; the same suite through the socket launcher | `pnpm --filter @mostra/runtime test:integration -- actions` | pass; seed (Node's permission model on workers) red, then green |
| AC-02 | verified | A run is `queued` before it runs and recorded with `action.started`; its progress, log lines and streamed results reach the page; a tab reloaded mid-run (and a second tab) shows it again with its progress and its end, in three engines; a run attached from a new browser after it ended reads the whole result; `action.succeeded|failed|cancelled` is the final event; a run's log stops at 1 MB with a marker; results past 16 MiB stop the run (`too-large`); `useAction` renders progress, log and result in a real React DOM | `pnpm check --job e2e` (`actions.spec.ts`); integration as above; `pnpm --filter @mostra/react test` | pass; seed (a reloaded page can't find its keyed run) red, then green |
| AC-03 | verified | A double click and a second tab, with one key, send one mail to a counting fake mail server, in three engines; a reload after it finished joins the same run and sends nothing; a retried request with the same client key joins its run; a hook without a key joins its own in-flight run on a double click and starts a new one after it ends; another viewer's click joins a keyed run, while a run without a key stays its viewer's own | `pnpm check --job e2e` (`actions.spec.ts`); integration; `pnpm --filter @mostra/react test` (browser) | pass; seeds (keys don't join; the hook doesn't join; any viewer reads another's run) red, then green |
| AC-04 | verified | Cancel reaches the action's `abortSignal` (the fixture rejects with its reason) and the run ends `cancelled`, through the gateway and in three engines; a run cancelled while its worker backs off ends at once and never runs | as above; `lifecycle.test.ts` | pass; seeds (cancel never reaches the signal; cancel waits for the worker) red, then green |
| AC-05 | validated | A run's `signal()` and `emit()` reach a host subscribed over its own connection (`events/subscribe`, `events/notify`) as `signal.raised` (`source: "action"`) and `host.mail.sent`, each with the run as its causation, between `action.started` and `action.succeeded`; no view ID of the run's viewer reaches other pages | `pnpm --filter @mostra/runtime test:integration -- actions` | pass; seed (no causation) red, then green. Boundary: the conformance kit's scenario is WP-12's (route C), built on these methods |
| AC-06 | validated | Secrets are set by name (`secret/set`), scoped to the artifact or the home, kept as 0600 files in 0700 directories, never in the ledger; resolved by the host's `secrets` port first (a port-only value works, a disconnected host falls back to the store), then the artifact's, then the home's; a grep of the whole home (logs, ledger and its WAL, versions) and of every event finds no value, also after an action logged it, threw it, returned it, wrote it into state or a live source; a worker's environment holds neither the supervisor's variables nor any secret, the link's secret, cookies or CSRF token; the remote launch carries none; the mail server still receives the real value | as above, and `producers.test.ts` | pass; seeds (no redaction of handed-out values; the supervisor's environment inherited; a hand-written store file unredacted) red, then green. Boundary: exports (WP-13) and screenshots (WP-09) don't exist yet; each repeats the grep over its output |
| AC-07 | verified | `load` with `refresh`, `stream`, `watch` (a JSON file changed on disk, with a polling fallback for missed events), `always`, and `live/push` all update `useLive`; values reach pages through the event stream and the long poll in three engines; the append mode keeps the ring's window; no built version contains Vite's hot-reload client (`@vite/client`, `import.meta.hot`) | `pnpm check --job e2e` (`actions.spec.ts`); integration; React browser tests | pass; seeds (live values never published; a version carrying Vite's client) red, then green |
| LL-04 | verified | Live updates produce no durable event (the artifact's events after the reads hold only view events); the latest value and revision persist and are read back; the ring stays at its bound (20) after more than 40 revisions, whatever window a page asks; an `always` producer runs with no viewer, others run only while a page holds interest (a minute, renewed) or a host subscribes to the artifact, and stop when neither does | `pnpm --filter @mostra/runtime test:integration -- producers actions` | pass; seed (`always` ignored) red, then green |
| RS-01 | verified | One test per D19 seam: (1) the manifest's `mode` defaults to `spa`, `spa` explicitly gives the same version, `rsc` is refused; (2) `"use server"` exports compile to client stubs carrying only their IDs while the bodies go only into `server/entry.mjs`, React's Server Function types (FormData with a file, `-0`, `NaN`, bigint, Map, Set, dates, typed arrays…) round-trip through a real worker, a class instance is refused with `MOSTRA_ACTION_UNSERIALIZABLE`, and the serializer's conformance suite agrees with React's own codec (`react-server-dom-parcel` 19.3.0); (3) concurrent calls of two viewers keep their own `viewer()` across awaits (AsyncLocalStorage); (4) `@mostra/react`'s entries carry `"use client"`, import without browser globals, and reach the shell only from a frame; (5) worker entries come through `RenderMode.serverEntry` | `pnpm --filter @mostra/runtime test:integration -- seams`; `pnpm --filter @mostra/react test`; `pnpm --filter @mostra/protocol test` | pass; seeds (one shared context; no `"use client"`) red, then green |

## Reviews (D80)

The GPT-6.1-Sol review through `codex review` is next, announced to Mirza first (D34). Copilot: requested on every push. A Claude Opus 5.5 review waits for Mirza's approval (D114; this is a substantial package).

Before the independent reviews, my own review of the full diff found and fixed these, each with a regression test that fails on the code before the fix (seeds `wp08-self-1` to `wp08-self-5`, and the line splitter by hand):

| Finding | Fix | Proof |
|---|---|---|
| A watchdog ping queued behind a large result (17 MiB through the socket launcher) stopped a healthy worker as hung | Silence stops a worker only after three unanswered pings in a row; a blocked event loop is still caught by the channel thread's answer | Lifecycle test: a SIGSTOPped worker is stopped after three periods, not one; the 17 MiB result through the socket host |
| `LineSplitter` searched the whole buffered line again for every chunk: a 32 MiB line took 1.6 s | Only each new chunk is searched | Protocol test: 20 ms, bound 500 ms |
| A plain call's result had no bound, so a large one buffered without limit | Plain calls stop at 16 MiB like runs (`MOSTRA_ACTION_TOO_LARGE`), and a reader that goes away cancels the call | Integration test for calls and runs, arguments too |
| A cancel waited for the worker of a run still starting or backing off (up to 60 s) | The run ends cancelled at once and never runs | Lifecycle test |
| Any viewer could attach to, follow or cancel another viewer's run without a key, and see its log and result | A run without a key is its viewer's own; keyed runs stay shared (D130) | Integration test with a second viewer |
| A daemon started by hand before `service install` still exited when idle, and the service's own start only attached to it | An installed login service keeps any daemon of its home (D133) | Lifecycle test |
| A watchdog stop near the heap limit read as a hang on Linux (CI) | Named out of memory when the heap was at 80 % or more | The OOM case three times in a Linux container |
| A secret file written into the store by hand after start-up wasn't redacted when read | Every value read is registered with the redactor | Integration test |

## Deviations

- **Run storage.** DATA_MODEL's sketch had `result_json` and `log_blob`; results are stored as serializer batches in `action_run_batch` (an `AsyncIterable` result is a sequence of batches) and the log as text with a line count, so a page that attaches late replays both (D130). DATA_MODEL §3 is updated.
- **Four runtime modules** beyond REPO_STANDARDS §3's list: `actions`, `workers`, `secrets`, `service`, now in the list and in `tools/package-map.ts`, so the boundary rules cover them (a seeded deep import into `workers/pool.ts` fails `boundaries`).
- **D99 amended by D132**: artifact listeners not viewed in 7 days bind when used.
- **Size budgets.** `@mostra/protocol`'s whole entry rose to 38 kB (the action, live and worker shapes; the serializer has its own 5 kB budget); `@mostra/react` to 53 kB with Zod and 30 kB without (`useAction`, `useLive`, the serializer).
- **`secret/set` and `secret/delete` aren't recorded under a `requestId`** (INTERFACES §6 says every mutating method takes one): setting a value again is idempotent, and a recorded digest of a short secret could be guessed from a copy of the ledger.

## Agent-facing and viewer-facing prose

Delegated as in WP-03 to WP-07 (M22, `<ITU/>` for all twelve questions):
- **Diagnostic hints** of the 13 new codes (`packages/protocol/src/diagnostics/codes/{action,runtime,secret,live,env}.ts`, pages in `docs/reference/errors/`).
- **`AGENTS.md`** of the new `@mostra/server` and `@mostra/worker`, and the additions to `runtime` and `react`.
- **Viewer-facing words** (question 12, shown here as promised): the shell's notice for a parked worker, `packages/shell/src/words.ts`: "This artifact's server code keeps crashing." and "Its buttons and live data won't work until a fixed version is published."

No Skill text: the Skill is WP-14's, and its specification now lists what its references must say about WP-08's API, provider idempotency keys included (the risk note).

## Untested boundaries

- **The service manager itself.** `mostra-runtime service install` was run with `--no-start` only: no LaunchAgent was loaded with `launchctl bootstrap` and no unit enabled with `systemctl --user`, on this machine or in CI. The unit files are checked (`plutil -lint`, content), and the daemon they run is checked (`--always-on`).
- **Exports and screenshots** don't exist yet: WP-13 (`static`, `bundle`) and WP-09 (`verify`'s screenshots) repeat AC-06's grep over their outputs.
- **AC-05's conformance scenario** is WP-12's kit; WP-08 proves it through the host protocol.
- **A launcher on another machine.** D124's seam is proven by a worker host started on its own over a Unix socket on the same machine; the relay (WP-28, WP-29) is the first remote one.
- **Secrets shorter than 4 characters** aren't redacted (a two-character value would redact every occurrence of those letters); the store accepts them.
- **Native modules in server code.** The server bundle is fully bundled (WP-03's `noExternal`), so an on-demand npm package that loads a `.node` addon from its own directory would find no such directory beside the version (found by reading the build, not by a test). Node's built-ins, processes and the network all work (AC-01). Raised with Mirza with the candidate.
- **Real Safari** wasn't run for WP-08's flows (Playwright WebKit was).
- **macOS start times** keep one-second resolution (D134): the evidence is XNU's PID allocation and a local spawn-rate measurement, not a test that reuses a PID.

## Commits and publication

- **Range:** `b0da907..HEAD` on `wp/08-workers-actions` (signed-off commits; the final range and merge commit are recorded after acceptance).
- **Packages:** nothing published; changesets record minor releases of `@mostra/protocol`, `@mostra/react`, `@mostra/runtime` and `@mostra/shell`, and the first releases of `@mostra/server` and `@mostra/worker` (the release pipeline is WP-11's).
- **Issues:** #8 is closed by D134 once this merges.
- **Remaining dirty paths:** none in the repository. Outside it: scripts, logs and prototypes in `$JCODE_SCRATCH_DIR/wp08`.

## Next

WP-09, verify (`docs/design/work-packages/WP-09.md`).
