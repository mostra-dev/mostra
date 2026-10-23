#!/usr/bin/env python3
"""Generate docs/design/work-packages/WP-NN.md from WORK_PACKAGES.md, REQUIREMENTS.md, the evidence checks
in evidence_matrix.py and the per-package detail below. Edit this file or the dossier, then regenerate.
With --check it writes nothing and fails when a committed specification is stale (CI docs job)."""
import re, sys
from evidence_matrix import D, load, CHECKS

DETAIL = {
"WP-01": dict(
  goal="A repository where good, modular, verified code is the path of least resistance, before any product code: every gate from REPO_STANDARDS running locally and in CI, the governance files, the agent documentation skeleton, and the protocol package's foundation (IDs, revisions, diagnostics) that every later package builds on.",
  reading=["../REPO_STANDARDS.md (all)", "../INTERFACES.md §1 (conventions) and §13 (diagnostics)", "../DATA_MODEL.md §2 (identifier forms)", "../VERIFIED_FACTS.md (tool versions; re-verify each before pinning)", "../STANDARDS.md (repository discipline, versioning, security)", "../rounds/ROUND-3.md §11 (package map and standards, D65)"],
  detail=[
    "Workspace: `pnpm-workspace.yaml` with catalogs for every shared dependency; `packages/protocol` as the first real package; empty-but-valid skeletons for the other P2 packages are not needed (generators create them when their WP starts), but the dependency-cruiser rules for the whole package map are written now.",
    "`@mostra/protocol`: branded ID types and parsers for every prefix in INTERFACES §1; dated revision type and negotiation helper (highest common revision, refusal diagnostic); the Diagnostic Zod schema with the area list from INTERFACES §13; JSON Schema 2020-12 and draft-07 emitters; the schema snapshot test that fails on any non-additive change (field removed, type narrowed, enum value removed, required added).",
    "Diagnostic catalog: codes declared in one source file per area; a generator emits the catalog JSON and one docs page per code (rendered later by the docs site, WP-26); a CI check fails on a code without docs text or on a removed code.",
    "Gates, each proven by a seeded violation in a test fixture: boundary import across the package map, unused export (knip), size budget, API report change without a changeset, non-additive schema change, non-OSI or PolyForm dependency in the core (license audit), unsigned commit (DCO), unpinned action (actionlint or pin check), Rust fmt and clippy, cargo-deny.",
    "CI: the plan job computing affected packages and the jobs in REPO_STANDARDS §6 that apply to what exists now (format-lint, types, unit, build, boundaries, api, licenses, rust, docs, supply-chain); later WPs add their suites to the existing jobs, not new workflow files. Measure the wall-clock of a typical pull request and record it.",
    "Port `tools/design/evidence_matrix.py` and `tools/design/wp_specs.py` into the docs CI job so the matrix and the WP specifications can never drift from the dossier.",
    "Local parity: `pnpm check`, `pnpm check --affected`, `pnpm fix`, `pnpm gen <name>` (generators for package, diagnostic code, protocol method; others are added by the WPs that need them), lefthook hooks.",
    "Already present from the design session: `LICENSE` (canonical Apache-2.0 text, SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`) and a minimal root `README.md`; keep the license, add `NOTICE`, and replace the README with the full one.",
    "Documentation: root `AGENTS.md` and `CLAUDE.md` (importing it) with commands, the package map, invariant owners, the WP workflow and the D49 agreements; `docs/agents/` playbooks for the tasks that exist now; README for humans; governance files. The root AGENTS.md text is agent-facing prose: draft it with Mirza (D74); WP-14 finalizes it.",
    "Rust: a cargo workspace with `crates/` placeholders only if needed for fmt/clippy/deny wiring; the crates themselves come in WP-12 and WP-22.",
  ],
  out=["Product packages other than `@mostra/protocol` (WP-02 onward).", "The release workflow and publishing (WP-11); WP-01 only adds Changesets and the API gate.", "Final Skill and AGENTS.md prose (WP-14)."],
  risks=["Tool majors moved recently (pnpm 12, Vitest 5, TypeScript 7, Changesets 3): re-verify and add churn notes (D48).", "TypeScript 7 lacks the JS compiler API: typescript-eslint and dependency-cruiser run on a pinned TypeScript 6, and API Extractor brings its own (REPO_STANDARDS §4).", "Branch protection that requires checks before the checks exist can block your own merge: add required checks after the first green run."],
  handoff="A green `main` with every gate live, `@mostra/protocol` at 0.x with IDs, revisions and diagnostics, generators and playbooks, and CI timing recorded. WP-02 adds the supervisor on top without touching the machinery.",
  publication="D76 authorizes it all: the repository `mostra-dev/mostra` exists with `main` pushed by the design session. Push `wp/01-foundation` and open a pull request early, so CI runs on GitHub while you work and its timing becomes evidence. Configure the repository: private vulnerability reporting, secret scanning with push protection, branch protection on `main` with the CI checks required and DCO enforced, Actions permissions read-only by default with SHA pinning, CODEOWNERS, labels, and Pages for the docs site (WP-26 deploys it). The protected `release` environment is WP-11's. Merge to `main` after Mirza accepts (D36). Record every setting you change in the progress report.",
),
"WP-02": dict(
  goal="One supervisor per home that hosts and clients can always find, that survives races, crashes and stale state, and that owns the ledger and every child process.",
  reading=["../ARCHITECTURE.md §4", "../INTERFACES.md §6 (session methods) and §1", "../DATA_MODEL.md §1, §3 (`child`, `schema_migration`), §6", "../FAILURE_MODEL.md §1, §2, §3, §10", "../VERIFIED_FACTS.md (process model, sqlite)"],
  detail=["Home resolution order at process start: `--home` (an SDK passes its `home` option this way), `MOSTRA_HOME`, platform default; create 0700, tighten an owned home, refuse one owned by someone else (D84, D85).", "The ledger's exclusive SQLite lock decides the owner; the socket (runtime directory and hashed name per D82, 104-byte limit on macOS) and `instance.json` are discovery only; losers attach through `instance.json`; the owner re-creates a vanished socket (D81).", "`mostra host` over newline-delimited stdio and the socket server share one protocol dispatcher; port callbacks bind to the registering connection.", "Ledger module: better-sqlite3, WAL, `synchronous=FULL`, migrations with file backup, integrity check, `MOSTRA_HOME_TOO_NEW`; the only writer.", "Process manager: spawn in a new process group, record PID and start time, reap on start, IPC with typed messages, exit on IPC disconnect in children.", "Platform gate before touching the home (D35)."],
  out=["The gateway (WP-05), builder (WP-03), workers (WP-08)."],
  risks=["Start-time reading differs on macOS and Linux (`ps -o lstart` vs `/proc/<pid>/stat`): test both in CI."],
  handoff="A protocol server with negotiation, a ledger with migrations, and a process manager every later child uses.",
),
"WP-03": dict(
  goal="Turn any ordinary React or MDX source into an immutable, content-addressed version atomically, without the supervisor ever running artifact code.",
  reading=["../ARCHITECTURE.md §2, §3", "../INTERFACES.md §2.1, §2.2, §11, §15 (bundle layout)", "../DATA_MODEL.md §1, §2, §3 (artifact, source_binding, version)", "../FAILURE_MODEL.md §3", "../rounds/ROUND-3.md §7 (RenderMode)"],
  detail=["Manifest extraction with Oxc on the entry (literal only); MDX frontmatter.", "Builder child: Vite 8 with the SPA RenderMode, React 19.3, MDX 3, Tailwind 4; the `\"use server\"` transform emits client stubs and a registry of server functions (with `dryRun` references detected) for WP-08 and WP-09.", "Digests exactly as DATA_MODEL §2; source snapshot tarball in the home.", "Publish steps 1 to 7 of ARCHITECTURE §3 except the verify gate (step 4 added by WP-09); fault injection hooks for tests.", "`artifact/create`, `artifact/publish`, `artifact/list`, `artifact/get` protocol methods.", "The gated child launcher (issue #7, D93): every child starts as `/bin/sh` waiting on an inherited pipe and `exec`s its command only after the supervisor has recorded its PID and start time, so a supervisor killed between spawn and record leaves nothing running; an integration test kills the supervisor in that window.", "Check boundaries (D93): `verify` in AU-01 and AU-02, results in AU-04 and VR-11, regression baselines in VR-11, and verify and action calls in the RT-02 audit are closed by WP-06, WP-08 and WP-09 on WP-03's fixtures."],
  out=["Dependency installs beyond the warm set (WP-04)", "Serving (WP-05)", "The verify gate (WP-09)"],
  risks=["Build determinism: record `outputDigest`, never claim reproducibility (VR-01)."],
  handoff="Published versions in the store, a builder registry other packages read, and receipts hosts rely on.",
),
"WP-04": dict(
  goal="Any npm package works on demand, offline works for everything in the store, one React copy, and install scripts never run with the supervisor's authority.",
  reading=["../ARCHITECTURE.md §3", "../DATA_MODEL.md §1 (deps/)", "../FAILURE_MODEL.md §9, §10", "../DECISIONS.md D20, D43", "../rounds/ROUND-3.md §1.1 and §1.2 (warm set, plus `@hookform/resolvers`, D72)"],
  detail=["Use pnpm's MIT store and linking through its programmatic or CLI interface, never `pnpr/`; installs run in an install child with the artifact's cwd and environment.", "The warm set is a pre-built layout inside the runtime; resolution prefers it; on-demand packages declare warm packages as peers so React stays single.", "`mostra add`, the `explicit` policy, `MOSTRA_DEP_MISSING`, `MOSTRA_DEP_OFFLINE`, `MOSTRA_DEP_TIMEOUT`.", "The warm set starts as the unpublished package `@mostra/warm` (D91), which each WP-03 build links as its `node_modules`; turn it into the pre-built warm layout of the store, add the rest of ROUND-3 §1.2's warm set, and extend WP-03's `lock.yaml` additively with on-demand packages."],
  out=["Kit-specific packs (WP-18)"],
  risks=["Peer resolution across store layouts can duplicate React: the single-instance check is a test, not an assumption."],
  handoff="A lockfile per version and a store any later package installs into.",
),
"WP-05": dict(
  goal="Only capability holders can use an artifact: the gateway, addressing and sessions implement the whole hygiene checklist and serve published versions with no process.",
  reading=["../ARCHITECTURE.md §5, §10", "../INTERFACES.md §4 (enter, tickets), §5, §6 (view/url, view/revoke)", "../DATA_MODEL.md §3 (port_lease, token, session)", "../FAILURE_MODEL.md §8", "../VERIFIED_FACTS.md (addressing prototype, cookies per engine)", "../../research/brief5.md (hygiene checklist sources)"],
  detail=["Leased ports per home; shell port plus one per opened artifact; reuse across restarts.", "Token: 128+ bits CSPRNG, stored hashed, scopes, expiry optional, rotation, revocation (410).", "Cookie mode: exchange token for an origin-bound `HttpOnly; SameSite=Strict` session; shell hands the frame a single-use ticket; strip tokens from URLs with redirects and `history.replaceState`.", "Exact Host allowlist, exact Origin on non-GET, streams and upgrades, CSRF header plus JSON content type, CORP, `Referrer-Policy: no-referrer`, rate limit on token paths, redaction in logs.", "Static serving of version files; minimal shell app with the iframe and the validated bridge transport (message set grows in WP-07 and WP-20).", "Strip Mostra cookies before any proxying (used from WP-08 on).", "`PublishReceipt.url` (D90): set the capability URL on every publish from this package on; WP-03's receipts carry none. Extend WP-03's publish integration tests to assert it.", "Serve WP-03's render fixtures (`packages/runtime/test/integration/render.test.ts`: single TSX, single MDX, the directory with `pages/` and deep links) through the gateway in Chromium, Firefox and WebKit; WP-03 rendered them in Chromium only, from a test server.", "Decisions taken in the package (M16): D96 (check boundaries), D97 (capability links: fragment tokens derived from the home key, the default link, scopes with `action:*`, `view/rotate`), D98 (cookie-mode sessions, CSRF delivery, frame tickets, `frame-ancestors`, one current version per browser and artifact origin) and D99 (`--bind`, `--url-host` and port leases)."],
  out=["Worker mode (WP-13)", "Trusted controls and banner (WP-07)", "Review overlay (WP-20)"],
  risks=["WebKit drops `Secure` cookies over HTTP localhost (prototype): never set `Secure` on loopback HTTP."],
  handoff="Viewers can open versions safely; later packages add endpoints behind the same checks.",
),
"WP-06": dict(
  goal="The ledger's interaction core: fields, submissions, delivery, events, signals, wait and results, correct under every concurrency and failure case.",
  reading=["../ARCHITECTURE.md §6", "../INTERFACES.md §6 (interaction, events), §7 (submissions port), §8", "../DATA_MODEL.md §3, §4, §5", "../FAILURE_MODEL.md §4, §5", "../../research/brief5-second.md (canonical objects and the submission transaction; long, so a fast-worker summary with this file named is acceptable)"],
  detail=["Per-field rebase on mutations; conflicts returned per field; mutation IDs replay results.", "Submit transaction exactly as ARCHITECTURE §6 with the write-once trigger; policies once (per-artifact, per-viewer), epochs, none.", "Outbox dispatcher with backoff, ordered replay on port registration, `HomeConfig.ports` expectation, 30 s port-call timeout, terminal rejections.", "Events: home cursor and per-artifact sequence in the same transaction as the change; subscribe with filter, ack per subscriber name, read; compaction behavior per DATA_MODEL §4.", "`wait` semantics (level for submitted, edge otherwise); results JSON and Markdown.", "The `event` table and the `artifact.created` and `version.published` appends exist since WP-03 (D90): build cursors, filters, subscriptions, acks and the other event types on that table, and add results' artifact metadata from WP-03's `artifact` and `version` rows (closing the results part of AU-04 and VR-11, D93).", "WP-05's gateway (D96, D97, D98) declares the browser-protocol routes with their scopes and checks: attach the `fields`, `submit`, `signal` and `events` handlers to the declared routes, and repeat WP-05's scope tests with them (a view-only link can't submit or write a draft). Add `view/url`'s `viewer` parameter (D97 item 7): the viewer a token's sessions act as, recorded in `viewer` and `token.viewer_id`; until then every session is the home's local user."],
  out=["Browser client (WP-07)", "Actions (WP-08)"],
  risks=["Ordering: never append an event outside the transaction of its change."],
  handoff="Hosts can already integrate through the protocol: publish, wait, results, events, deliveries.",
),
"WP-07": dict(
  goal="The client runtime agents use and the shell's trusted controls: input that is never lost, converges across tabs and devices, and is submitted only by the human through a control the artifact can't forge.",
  reading=["../INTERFACES.md §2.3, §4, §5", "../ARCHITECTURE.md §5, §6", "../FAILURE_MODEL.md §5, §7", "../DECISIONS.md D39 to D42, D52, D53, D57, D63", "../rounds/ROUND-2.md §1 (author experience)", "../rounds/round4-shell/ (shell direction, D68)"],
  detail=["From WP-06 (D101, D104, D106): the browser protocol's first revision is `2026-10-15` (`BROWSER_PROTOCOL_REVISION`, served by WP-06's `fields`, `submit`, `signal`, `events` and `events/poll`), and the client runtime adds it to `envDigest`'s `browserProtocolRevision`. The shell gets `viewId` from its ticket answer and hands it to the frame over the bridge; every mutation and submit names it. Build the shell's trusted Submit as the `shell` channel (the submit transaction already records either channel and raises the `submit` signal), the host's channel policy, no Submit control under policy `none` (LL-02's browser part), and required-field blockers in the client (D106: the server never guesses what a page shows). Repeat WP-06's IN-06 and LL-02 checks through the real shell and client.", "Every hook of INTERFACES §2.3 except `useAction` and `useLive`; `window.storage` per D53; RHF adapter; React Router `pages/` integration with history per target.", "Debounced saves with flush on blur, `visibilitychange`, `pagehide` and before submit; IndexedDB journal; BroadcastChannel latency path.", "The browser protocol from its first revision `2026-10-15` (WP-06), with a fixture-based compatibility test framework for revisions N and N+1.", "Shell: trusted Submit and Choose honoring channel policy, delivery states, version banner, follow, the 'Not carried over' panel; the visual design follows the round-4 direction and gets its final pass in WP-20.", "`@mostra/react` exists since WP-03 with `defineArtifact` and `createServerReference`; WP-03's builder generates the client entry that mounts the page, or the `pages/` routes inside the entry's layout with browser history (INTERFACES §2.1). Add the history mode per delivery target, page reporting to the shell, and `fields` in `registry.json`, and set `browserProtocolRevision` in `envDigest`.", "WP-05 compiled a bridge client into every version (`@mostra/react`'s internal `bridge`, started by the generated entry): it reads its shell origin from `GET /_mostra/session`, accepts messages only from the parent window at that exact origin, and speaks `ui/initialize`, `ui/notifications/initialized` and `mostra/ready`. Grow the message set on it (ROUND-3 §8), and serve the browser protocol's mutations behind the gateway's declared routes with the session's CSRF token (D98). An artifact origin serves the version its frame session last entered (D98 item 5): the banner must tell a tab whose version is no longer its session's."],
  out=["Review overlay and review sets (WP-20)", "Actions and live data hooks (WP-08)"],
  risks=["Forgery tests must include synthetic clicks, overlays covering the shell, and postMessage spoofing from the artifact origin."],
  handoff="One-off artifacts work end to end in the browser; long-lived artifacts have state, follow and policy none.",
),
"WP-08": dict(
  goal="Agent-authored server code with full capability, isolated for stability: durable action runs, live data and artifact state from the server.",
  reading=["../ARCHITECTURE.md §7", "../INTERFACES.md §2.3 (useAction, useLive), §2.4, §4 (call, runs), §7 (secrets, WorkerLauncher)", "../DATA_MODEL.md §3 (action_run, live_value, live_ring)", "../FAILURE_MODEL.md §2 (workers), §6", "../DECISIONS.md D19, D24, D44, D54 to D56, D62", "../VERIFIED_FACTS.md (React server function serializable types)"],
  detail=["From WP-07 (D108 to D115): `useAction` and `useLive` join `@mostra/react` on its `Store` (`packages/react/src/runtime/store.ts`) and `HttpTransport`, so they reuse the view, the CSRF token, the event stream with its long-poll fallback and the journal's tab presence; the frame's `call/…`, `runs` and `runs/…/cancel` routes are declared in the gateway behind the action scopes. Pages report run states to the shell over the bridge if the shell shows them; the shell's trusted-control rules (armed controls, D108 channel policy per view) stay as they are.", "From WP-06 (D101): `signal()` in `@mostra/server` raises through the interaction core's `raiseSignal` with `source: \"action\"` and the run as causation; results' `actions` list the runs started in the submission's view (empty until then), and the Markdown golden already renders them. A server-side `state` write is `applyMutation` with an agent actor and its own mutation ID.", "Worker: loads the version's server bundle, executes calls inside AsyncLocalStorage, never sees cookies or tokens; WorkerLauncher as the seam.", "Serializer with a conformance suite mirroring React's documented Server Function types plus AsyncIterable.", "Runs: recorded before start, keys unique per artifact and action, join semantics, cancel, `interrupted` on crash, 1 MB log cap.", "Live sources: producers per D56/D63 with persisted latest value, ring buffer, pushes; ephemeral delivery.", "Lifecycle: watchdog, heap limit, idle eviction, backoff, parking; port leases for artifacts with server code.", "Five RSC seam tests (RS-01).", "`WorkerLauncher` takes a version reference (D124): `launch` receives the version's digest and a locator for its portable bundle, never a directory path, and the local launcher resolves it to a path. `WorkerChannel` carries only serializable messages, and secrets reach a worker only through the secrets port, never through its inherited environment. Prove the seam: the action suite passes against a second fixture launcher whose worker is a separately started process over a socket. Leave room in the run states for WP-28's \"waiting for the owner\" (additive), so the relay (D117) needs no migration.", "Extend WP-03's RT-02 process audit (`packages/runtime/test/integration/audit.test.ts`) to action calls and live producers, and load WP-03's server bundle (`server/entry.mjs` with the function registry); replace the client runtime's unavailable server-call transport with the real one (D93).", "WP-05's gateway declares `call/{fnId}`, `runs` and `runs/{id}/cancel` with the `action:<name>` scope rule of D97 item 4 (`action:*`, `action:<export>`, `action:<module path>#<export>`): attach the handlers there, check `runs`' function ID against the session's scopes, and repeat WP-05's scope test with a real action (a view-only link can't run it). Strip Mostra's cookies before forwarding to the worker (D38). Keep WP-05's RT-05 test green: a worker starts only for a version with server code (D96)."],
  out=["Verify's use of dry-run (WP-09)"],
  risks=["Effects of a run killed mid-flight: document provider idempotency keys in the Skill references."],
  handoff="J3's inbox works: real Send, once per click, progress, secrets out of every artifact output.",
),
"WP-09": dict(
  goal="The decisive feature: one command that tells a blind agent, in stable JSON, whether its artifact builds, renders, works and still does what it did last time.",
  reading=["../ARCHITECTURE.md §12", "../INTERFACES.md §13", "../rounds/ROUND-3.md §9", "../evaluations/eval-01/EVAL-01.md (checker lessons, D72)", "../../research/brief6.md §2 (pipeline, token budget)", "../FAILURE_MODEL.md §9"],
  detail=["From WP-08 (D129 to D133): a dry run is a plain call with `dryRun: true` in the worker call's context (`CallContext.dryRun`, `worker/call`); the worker's `dryRun()` reads it. `registry.json`'s `actions[].dryRun` says which exports opted in. `verify` clears a parked worker of the artifact (`pool.clear`, as a publish does). Extend the RT-02 audit (`test/integration/audit.test.ts`, which WP-08 extended to calls, runs and live sources) to verify runs.", 'From WP-07 (D109, D111): `registry.json` has `fields` (`{ open, openReasons, entries }`, `packages/runtime/src/builder/child/fields.ts`), the static scan AU-05\'s duplicate and changing-ID checks start from; the target `verify` (`<meta name="mostra-target" content="verify">`) routes with browser history like `live`, and `mountArtifact` and `mountRoutes` report `mostra/ready` once the runtime\'s first snapshot arrived (or after 3 s), which verify waits on.', "Stages in order with early exit on compile failure; warm browser in the verify runner child.", "Severity rule from D72: smoke observations without a runtime error are warnings; hover-opened and already-active controls classified before judging; never click through actions that didn't opt into `dryRun()`.", "Regression baseline: the last passing version's ARIA snapshot, pixels and contracts (fields, actions, live sources).", "Cached verdict by source and env digest; publish gate with `--force` recording codes.", "Screenshot token estimates for Claude, GPT and Gemini formulas (brief 6).", "Readiness: boot and render wait on the Mostra readiness signal and server health, never on fixed sleeps (EVAL-01b found a start-up race in a sleep-based checker).", "Run `verify` on WP-03's AU-01 and AU-02 fixtures and extend its RT-02 process audit to verify runs; regression baselines come from the last passing version stored in the home (its build and `registry.json`), never from the authoring directory (VR-11, D93).", "Verify resolves packages exactly as publish does, through WP-04's `Dependencies.resolve` with the same working-lockfile key (D95), so its cached verdict's `envDigest` (which includes `lockDigest`) matches the publish that follows; `MOSTRA_DEP_*` diagnostics are compile-phase verdict entries."],
  out=["Kit-specific lint rules (WP-18), terminal lint (WP-22)"],
  risks=["False positives make agents break working code (EVAL-01): every new check needs a negative fixture proving it doesn't fire on correct code."],
  handoff="Agents can iterate to `pass` and publish safely.",
),
"WP-10": dict(
  goal="The CLI agents use every day: every capability through one thin client, predictable JSON, exit codes and no prompts.",
  reading=["../INTERFACES.md §6, §9", "../DECISIONS.md D60", "../rounds/ROUND-2.md §3.1", "../FAILURE_MODEL.md §2 (version skew)"],
  detail=["From WP-08 (D131, D133): `mostra daemon install|uninstall` run `mostra-runtime service install|uninstall [--home]` (one JSON line; `MOSTRA_ENV_SERVICE_FAILED`, exit 3); `mostra daemon status` can show `instance/status`'s `idleExitAt` and `workers`; `mostra secret set|list|rm` are clients of `secret/set|list|delete` (the value from stdin, never echoed); `mostra push` is `live/push`; `mostra doctor` finds the login service by `serviceStatus` (`packages/runtime/src/service/unit.ts`) for LL-05's warning (D96). CLI help for these is drafted with Mirza (D74).", "From WP-06 (D101): `mostra wait`, `results` and `state get|set|patch` are thin clients of `wait`, `results/get` and `state/*` (exit code 5 for `still_waiting`, 6 for `MOSTRA_SUBMIT_ALREADY` and conflicts); `mostra gc --compact-events --before <cursor>` calls the interaction core's `compactEvents` per artifact in one transaction, and its reads already answer `MOSTRA_HOST_CURSOR_COMPACTED`. IN-10's CLI check is closed here.", "Thin protocol client with daemon autostart and attach; NDJSON for streams.", "`mostra dev`: Vite HMR on a separate port, never reachable through capability URLs (VR-08).", "`doctor`, `gc` (reference rules, dry run), `docs`, `state`.", "Telemetry (D119, EN-08): the standalone CLI sends anonymous usage events by default, announced on first run and off through a setting, an environment variable or `DO_NOT_TRACK=1`; a host-spawned instance, and any home a host configures, sends nothing. Events carry no artifact content, paths, tokens, identities or IP addresses; useful fields are the command, its outcome and duration, the Mostra version, the platform and the agent or harness that ran it (MCP `clientInfo` or known environment markers). The endpoint is configurable and disabled in development builds. The event list and detection rules are a *Deferred decision* for this package with Mirza, and the first-run notice is agent-facing prose (D74); the event list is published in the docs.", "Help text generated from command definitions; the wording is drafted with Mirza (D74).", "`mostra dev` implements `RenderMode.dev` (ROUND-3 §7) beside WP-03's `build`, on the same SPA build settings.", "`mostra add <package…> [--artifact <path|id>]` is the client of WP-04's `deps/add` (D95), defaulting to the artifact in the current directory; `MOSTRA_DEP_MISSING`'s fix already carries that exact command, so add a contract test that runs the command a diagnostic names. `mostra dev` resolves packages through the same `Dependencies.resolve`.", "`gc` also collects WP-04's dependency state (D95): lock layouts in `deps/locks` that no working lockfile (`dependency_lock`) and no kept version's `lock.yaml` names (a `pinned-*` layout counts as named by the `lockDigest` its `.mostra-layout` marker records, D135), then `pnpm store prune` through the install child (pnpm 10, D94), removing the pruned packages from `dependency_package`; never while an install runs.", "`mostra doctor` closes LL-05's doctor half (D96): it warns when the home has artifacts with submission policy `none` (read through `artifact/list`) and no always-on daemon, which is the login-service unit WP-08's `mostra daemon install` writes for the home; extend WP-05's LL-05 evidence row with that check.", "Add `mostra dev` to WP-05's VR-03 route enumeration (`packages/runtime/test/integration/gateway.test.ts`, D96): no viewer URL reaches the dev server or the source it serves.", "`mostra open` and `mostra publish` print the capability URL; `mostra open --rotate` and `--revoke` are clients of `view/rotate` and `view/revoke` (D97)."],
  out=["`share` drivers (WP-13)", "`mcp` (WP-15)", "`plugin` (WP-16)", "`term` (WP-22, after the first release, D122)", "`export` classes beyond the receipt (WP-24)", "`mostra run <bundle>`, sign-in and sharing commands for remote servers (WP-29)"],
  risks=["Keep the CLI free of logic the protocol lacks: anything a host can't do through the protocol is a protocol gap to fix."],
  handoff="J1 runs end to end from a terminal.",
),
"WP-11": dict(
  goal="Users never install Node, hosts download one verified bundle, JavaScript hosts embed Mostra in a few lines, and releases publish themselves.",
  reading=["../ARCHITECTURE.md §4 (distribution)", "../REPO_STANDARDS.md §9", "../INTERFACES.md §6, §7", "../DECISIONS.md D18, D36, D67", "../VERIFIED_FACTS.md (publishing)"],
  detail=["From WP-06 (D101): the SDK's `wait`, `results` and `events` wrap the host methods, and its `submissions` port answers `port/submissions.deliver`; IN-10's SDK check is closed here, along with an SDK host receiving a delivery.", "Bundles for macOS arm64/x64 and Linux x64/arm64: Node LTS (24, or 26 after 2026-10-28), prebuilt code, warm set, headless Chromium, native modules; SHA-256 manifest and GitHub artifact attestation.", "Ship the warm set as the pre-built, read-only layout WP-04 links (`@mostra/warm`'s `node_modules`, found beside the runtime or through `MOSTRA_WARM_DIR`), and pnpm 10 beside the runtime as the install child's installer (D94; the license audit refuses pnpm 11 or later and `@pnpm/exe.*`). Lock layouts in a home link the warm set by path, so a bundle at a new path relinks them on use (WP-04 does it).", "Download, verify, cache by hash; `npm create mostra`; `@mostra/cli` bootstrap selecting the bundle.", "`@mostra/sdk` `createMostra({ home, ports })` over the spawned instance.", "Release workflow and exact account instructions for Mirza (npm org, trusted publishers per package, disallow tokens, crates.io); verify the first-crate-token hypothesis.", "The `ee/` boundary (D118, EN-09): `tools/package-map.ts` forbids any import from the core into `ee/`, the license audit treats `ee/` separately from the OSI-only core, and a packing check proves that no published core package contains an `ee/` file. The folder itself is created by the first package that needs it, under a license text Mirza supplies.", "Telemetry (D119): extend WP-10's EN-08 test to an SDK-spawned instance, which sends nothing."],
  out=["Rust crate (WP-12)"],
  risks=["Trusted-publisher configurations expire if unused for 2 days: configure them right before the first release."],
  handoff="Anyone can install Mostra; releases flow from merged release PRs.",
),
"WP-12": dict(
  goal="Hosts in Rust integrate without touching Mostra, and every host can prove its integration with a kit.",
  reading=["../INTERFACES.md §6, §7, §8", "../JCODE_HOST.md (all)", "../FAILURE_MODEL.md §4", "../../research/brief6.md §3.3, §4.4 (Rust codegen limits, conformance precedent)"],
  detail=["From WP-07 (D108, D113): conformance scenarios for the shell and the channel policy: a host shell implementing the bridge set (`mostra/fields`, `mostra/flush`, `mostra/controls.request`, `mostra/version.available`, `mostra/field.focus`, `ui/initialize` with `mostra`), `port/trustedControls.policy` and `.activated`, `HomeConfig.submitChannels`, `MOSTRA_SUBMIT_CHANNEL_DENIED` for the artifact channel, and the shell channel recorded on submissions and choices (SH-02's C route).", "From WP-06 (D101): conformance scenarios for IN-06 (drafts arrive only through `port/drafts.mirror`, labelled `kind: \"draft\"`), IN-07 (each policy), IN-08 (filtered subscribe, ack, resume after restart), IN-09 (signals as `signal.raised`, nothing woken by Mostra), IN-10 (wait level and edge, timeout cursors), IN-12 (host down, ordered replay, redelivery with the same `deliveryId`) and LL-02 (policy `none`), against WP-06's real methods.", "typify wire types from the draft-07 schema, committed with a snapshot test; hand-written tokio client; spawn and attach; bundle cache; port traits.", "`@mostra/conformance`: scenarios listed in the WP summary plus one per JCODE_HOST row; expected-failure baselines; reference hosts in Rust and TypeScript.", "Audit for host-specific code in the core."],
  out=["Jcode's own adapter (C03-B)"],
  risks=["typify is Draft-7-centric: keep the schema inside the subset it handles and fail CI when a schema leaves it."],
  handoff="C03-B has everything except tailnet sharing and the Skill, which WP-13 and WP-14 add.",
),
"WP-13": dict(
  goal="Viewing from anywhere the user chooses, never implicitly public: tailnet with identity, public shares behind explicit flags and short-lived tokens, and frames that work cross-site.",
  reading=["../ARCHITECTURE.md §5, §10", "../DECISIONS.md D38, D47, D70, D143", "../VERIFIED_FACTS.md (Tailscale, Cloudflare, PSL, frame sessions)", "../FAILURE_MODEL.md §8"],
  detail=["From WP-12 (D143 items 1 and 2): the `addressing` port is this package's (HO-10): `port/addressing.externalBase` gives a host's external base for an artifact's links (its own tunnel hostname), which joins the Host allowlist through the addressing module and the links Mostra mints; add it to the generic port path WP-12 built (the runtime's supported ports, the Rust traits in `crates/mostra-host/src/ports.rs`, the SDK's `Ports`) and its scenario to `@mostra/conformance`. The `identity` port exists (`port/identity.resolve`, asked at the shell session exchange for links without a viewer): requests through Tailscale Serve reach it with `via: \"tailnet\"` and the identity headers, with the tailnet mapping as the standalone default when no host answers, and public shares with `via: \"token\"`; extend its kit scenario to both.", 'From WP-08 (D133): an active share keeps a daemon from its idle exit: add the share count to the `busy` counts `watchIdle` reads in `packages/runtime/src/instance/index.ts`. Run and live updates reach worker-mode pages through the same stream and long poll (`PollResult.ephemeral`).', 'From WP-07 (D111): the `static` export writes `<meta name="mostra-target" content="static">` into `index.html`; the client runtime then routes by hash and keeps fields in local storage, as `tests/e2e/specs/pages.spec.ts` checks on a marked build: run that check on the real exporter\'s output (AU-09). The client\'s transport already falls back to `events/poll` after two stream failures; worker mode adds the ticket for it.', "`tailscale serve` and `funnel` driven when installed; identity headers mapped through the identity port; backend stays on loopback.", "Funnel port plan (443 shell, 8443 and 10000 artifacts).", "`cloudflared` quick tunnels with worker-mode frames; long-poll transport where SSE fails.", "Worker mode: bootstrap page, service worker at `/` with `Service-Worker-Allowed`, ticketed streams and WebSockets, diagnostic on conflicting registration; investigate the one-off Firefox install timeout from the prototype.", "WP-05's addressing module already picks the frame-session mode per origin pair (different hosts mean worker mode, D98) and its gateway declares `/_mostra/sw.js`, `/_mostra/v/{rev}/ticket` and the stream routes; build worker mode behind them. Registered tunnel hostnames join the gateway's exact Host allowlist through the addressing module."],
  out=["The remote server (WP-29, WP-30)"],
  risks=["External evidence needs a tailnet device and a phone: arrange with Mirza early in the session."],
  handoff="J8 works; C03-B's remote-link need (H-14) is met.",
),
"WP-14": dict(
  goal="Agents reach for Mostra whenever they want to communicate visually, and know the loop that leads to a verified, published artifact.",
  reading=["../DECISIONS.md D29, D69, D74, D147, D148, D149", "../rounds/ROUND-4.md part B", "/Users/mirzabicer/skills-temp/writing-for-agents/SKILL.md and SKILL-MECHANICS.md", "../../research/brief6.md §1, §3.4", "Every package AGENTS.md written so far"],
  detail=["From WP-08 (D129 to D133): the Skill's references cover the author API WP-08 added: `useAction` (keys make a run happen once across clicks, tabs, reloads and viewers; without one a double click joins the hook's run; `partial` for `AsyncIterable` results), `useLive` and `defineLive` (`load`, `refresh`, `watch`, `stream`, `always`, `ring`), `@mostra/server` (`progress`, `log`, synchronous `secret`, `signal`, `emit`, `state`, `viewer`, `abortSignal`, `dryRun`) and `mostra secret set`. A run cut off mid-flight ends `interrupted` and is never retried, so the references tell authors to pass the provider's own idempotency key (the run's key, say) on any external side effect (WP-08's risk note; `MOSTRA_ACTION_INTERRUPTED`'s page already says so).", "`skills/mostra/SKILL.md` under about 5,000 tokens with the single trigger (D69), the core loop and pointers to references; references for every API built so far.", "From WP-06 (D104, Claude review): the references say that a link minted without `viewer` acts as the home's one local viewer, so everyone given that link shares one draft and one `once` slot; links for several people each name their viewer (`view/url`'s `viewer`).", "Root `AGENTS.md` final text and the scaffolded artifact `AGENTS.md` used by `mostra new`.", "Harness-plugin generator producing real copies for Claude Code, Codex, Gemini CLI, Cursor and Copilot.", "D147: the generated plugins are built to pass the directories' review on the first scan. The Claude Code plugin is generated into its own repository layout with the manifest at the root, launches the local MCP server pinned to an exact version, has no hooks and is named `mostra`; its README discloses everything it runs, sends or fetches, every network destination included (the telemetry endpoint and how to turn it off, noting that a plugin-started server sends none, D148). For OpenAI's directory: no upgrade prompts or plan display, OAuth only, no hooks, no trial plugins. No MCP Bundle desktop extension. Verify each directory rule against its own pages on the day and record it in VERIFIED_FACTS.", "Prose iterated with Mirza; he accepts it in one batch at the end of the package (D149); mechanism tests may use placeholder text."],
  out=["MCP descriptions (WP-15)", "Later reference updates (each WP adding API)"],
  risks=["Never test prose by phrase matching (STANDARDS)."],
  handoff="The C03-B threshold (D73): Jcode can integrate.",
),
"WP-15": dict(
  goal="Any MCP client can author, verify, publish, wait for and read Mostra artifacts through a small, stateless tool set.",
  reading=["../INTERFACES.md §12", "../DECISIONS.md D32, D61, D119, D148, D149", "../../research/brief6.md §3.2", "../../research/brief7.md §1, §2 (client limits)", "../VERIFIED_FACTS.md (MCP SDK v2, spec revisions)"],
  detail=["v2 TypeScript SDK packages; stdio and Streamable HTTP with the full hygiene checklist on HTTP.", "From WP-06 (D104, Claude review): `artifact_open`'s description says that a link without a viewer is shared by everyone who holds it (one draft, one `once` slot).", "HY-01 item 13 (D96): apply `@mostra/protocol`'s `hygiene` checks, the same functions the gateway uses (exact Host, exact Origin, JSON content type, request-target and header sanity), to every HTTP request of `mostra mcp --http`, bind loopback by default, and prove each with a negative test; record the result as an extension of WP-05's HY-01 evidence row.", "Tools of INTERFACES §12; `artifact_wait` capped at 50 s; resources; tool names short and stable.", "Tool descriptions drafted with Mirza (D74).", "Keep the tool handlers independent of the stdio and HTTP transports, so WP-30 serves the same handlers as a remote MCP server over Streamable HTTP with OAuth (D116).", "Record the client's `clientInfo` from MCP initialization for D119's harness field, used only where telemetry is allowed (never in embedded use).", "D148: a server started from a harness plugin's launch configuration counts as embedded use and sends no telemetry, whatever the CLI's consent setting; prove it with a test that captures no outbound event.", "Tool descriptions are accepted by Mirza in one batch at the end of the package (D149)."],
  out=["App-only tools and MCP Apps export (WP-17)"],
  risks=["ChatGPT freezes tool snapshots: schemas evolve additively only (D32)."],
  handoff="Codex, Claude Code and other MCP clients use Mostra without a Skill.",
),
"WP-16": dict(
  goal="Anyone can extend Mostra through small, separately versioned contracts and copy-source packs, with honest license disclosure and no capability gates.",
  reading=["../rounds/ROUND-3.md §6", "../INTERFACES.md §14", "../DECISIONS.md D30, D31", "../../research/brief8.md §1, §2, §4"],
  detail=["Six contract packages with `define*` blueprints stamping contract IDs; loader with range checks, loading order and conflict diagnostics.", "Manifest schema and `mostra plugin validate|add|list|remove`.", "Packs as shadcn registry superset; any shadcn item installs unchanged.", "License classes, `--accept-license`, lockfile record, host pre-acceptance.", "Record license acknowledgments in the artifact's working lockfile (WP-04's `dependency_lock` row, frozen into `lock.yaml` at publish, D95) with an additive key, so they become part of `lockDigest`; a pack's npm dependencies install through `deps/add`."],
  out=["First-party plugins (WP-17, WP-23, WP-25)", "The registry (v1.x)"],
  risks=["Contracts are 0.x: additive changes only within a minor."],
  handoff="WP-17 builds the MCP App exporter on the exporter contract.",
),
"WP-17": dict(
  goal="The same artifact source renders inline in chat hosts as an MCP App, persisting through the local server, with a full-page URL always offered.",
  reading=["../INTERFACES.md §12, §15", "../VERIFIED_FACTS.md (MCP Apps spec: CSP, bridge, theme variables)", "../../research/brief1.md §2", "../DECISIONS.md D07, D61"],
  detail=['From WP-07 (D111): the `mcp-app` export writes `<meta name="mostra-target" content="mcp-app">`; `mountRoutes` then uses memory history, as `pages.spec.ts` checks on a marked build: run it on the real exporter\'s output (AU-09). The MCP Apps transport implements `packages/react/src/runtime/transport.ts`\'s `Transport` over the app-only tools; `boot.ts` currently starts mcp-app pages in local mode until it exists.', "Exporter plugin: single-file `ui://` resource, declared CSP, token-to-host variable mapping.", "Client runtime MCP Apps transport over app-only tools; memory routing.", "Explicit degradation messages (MC-03).", "In cloud chat hosts, exported apps persist drafts, submissions and actions through WP-30's remote MCP server (D116), which replaces D61's \"until then\" message; under local hosts nothing changes. WP-30 closed MC-04 up to the inline round trip (its check boundary): repeat MC-04's external check inline in claude.ai and ChatGPT through the remote MCP server, and extend WP-30's MC-04 evidence row with the result."],
  out=["The remote MCP endpoint itself (WP-30), which this package uses"],
  risks=["Host quirks per client: record per-host results as external evidence."],
  handoff="D17's three interfaces are complete.",
),
"WP-18": dict(
  goal="A beautiful baseline any agent gets for free and any agent can override completely: two bases, one token system, forms and questionnaires on fields, and guidance against churned APIs.",
  reading=["../rounds/ROUND-3.md §1", "../DECISIONS.md D26, D27, D48, D68, D72, D75, D141", "../evaluations/eval-01/EVAL-01.md (and EVAL-01b when recorded)", "../../research/brief3.md"],
  detail=["From WP-07 (D109): kit inputs bind through `useField` (or `useChoice`), and the field scan only recognizes hooks imported from `@mostra/react` in the artifact itself: a package that imports `@mostra/react` opens the version's coverage (`fieldHookUsePlugin`). Teach the scan the kit's `id` props, so versions using the kit keep exact orphan detection.", "Per-base registry packs (Base UI default, Radix), resolution without copying, `mostra add` copying.", "OKLCH tokens with dark mode, host brand themes and MCP Apps variable mapping. The default values are Studio (D141): its light and dark tokens, six chart colours, Figtree and Spline Sans Mono self-hosted in the kit, and its motion defaults.", "Questionnaire and form components on `useField`.", "Churn guidance and lint autofixes, including `MOSTRA_KIT_WRONG_BASE` from the TS2322 shape seen in EVAL-01 controls.", "Check EVAL-01b's result before setting the default (D75)."],
  out=["Data and visualization wrappers (WP-19)"],
  risks=["The Base UI template's `scroll-area.tsx` failed `tsc` out of the box (VERIFIED_FACTS): run the packs through Mostra's strict type-check in CI."],
  handoff="Kit visuals for every later kit package to build on.",
),
"WP-19": dict(
  goal="Every D26 library is one import away, themed by the tokens, and the live chart stays smooth at high rates.",
  reading=["../rounds/ROUND-3.md §1.2", "../../research/brief3.md §2, §3", "../VERIFIED_FACTS.md (kit versions; re-verify)", "../DECISIONS.md D26, D48"],
  detail=["Token-aware wrappers per library; warm set versus on-demand per D65.", "uPlot live chart on `useLive` append mode; set and measure the target rate (at least 60 updates per second with 10k points on CI hardware).", "License and version re-verification recorded in VERIFIED_FACTS.", "Team components (KT-11, D121): presence avatars, live cursors, a respondent tracker and attribution chips, built on WP-31's hooks, reading the tokens and accepting `className` (KT-10)."],
  out=["Motion and decks (WP-21)"],
  risks=["TanStack Table 9 and Mermaid 12 are new majors: add churn guidance."],
  handoff="J2's dashboard has every chart it needs.",
),
"WP-20": dict(
  goal="Review over any content, in a shell the artifact can't touch, with anchors agents can act on, and the shell's final design.",
  reading=["../ARCHITECTURE.md §8", "../rounds/ROUND-3.md §2, §8", "../INTERFACES.md §5, §8", "../DECISIONS.md D23, D47, D65, D68, D141", "../rounds/round4-shell/ and ../rounds/ROUND-4.md part A", "../../research/brief5.md §2"],
  detail=["From WP-12 (D143 item 1): the `reviews` and `capture` ports are this package's (HO-11): `port/reviews.mirror` (each thread and choice, best effort like draft mirrors) and `port/capture.screenshot` (the crop a comment stores, the verify runner's browser as the standalone default). Add them to the generic port path WP-12 built (the runtime's supported ports, the Rust traits in `crates/mostra-host/src/ports.rs`, the SDK's `Ports`) and their scenarios to `@mostra/conformance`.", "From WP-07 (D113, D108): `ReviewSet` asks for the trusted Choose with `useChoice(id, { candidates, current })`; the shell renders it under the armed-control rules (`packages/shell/src/model.ts`) and posts `review/choose` on the shell channel. The current page arrives as `mostra/page` (`data-shell-page`), for comments to record. The shell's visual pass keeps the trusted zone's behavior: armed controls, frozen while the pointer is over them, state words reserved.", "From WP-06 (D101): results' `comments` (threads with anchors and crop paths) and `choices` labels come from the review layer; the Markdown renderer and its golden already show them, so the review layer fills the snapshot and `buildResults` reads it.", "Overlay, threads (reply, resolve, reopen), multi-layer anchors with crops through the capture port.", "Anchor providers for charts, slides and timelines; bridge injection for served frames.", "Review sets: gallery, focus, synchronized compare with pixel diff, trusted Choose.", "`review export`.", "Final visual pass on the shell with design-focused review (ask Mirza for design skills); mobile layout. Start from Studio's tokens and faces (D141), keeping the shell quiet (D68).", "Review endpoints live on the shell origin under `/a/<artifactId>/_mostra/`, behind WP-05's shell-session, Origin and CSRF checks and the `review` scope (D97, D98).", "Mentions (CO-06, D121): an `@mention` of a viewer in a comment raises one durable event naming that viewer, which hosts filter and route; Mostra notifies nobody itself (D10)."],
  out=["Terminal cell anchors (WP-23)", "Motion and video anchors (WP-21)"],
  risks=["Crops of cross-origin frames come from the capture port, not from the page."],
  handoff="J1 complete: candidates, comments with crops, a choice, delivered together.",
),
"WP-21": dict(
  goal="Motion graphics and decks authored as ordinary React and MDX, deterministic for screenshots and reviewable in time.",
  reading=["../rounds/ROUND-3.md §3, §4", "../DECISIONS.md D26, D65", "../../research/brief3.md §4, §5"],
  detail=["`Timeline`, `Clip`, `useFrame`, `interpolate`, `spring`, controls, reduced motion; names distinct from Remotion's.", "Deck grammar, layouts, clicks, notes, presenter view, print to PDF.", "Time-and-region and slide-and-step review anchors (RV-06)."],
  out=["Remotion and GSAP adapters (WP-25)"],
  risks=["Determinism: frame rendering must not depend on wall-clock time."],
  handoff="J5's deck works.",
),
"WP-22": dict(
  goal="Terminal output agents can verify without vision and humans see exactly: one frame model, an owned renderer, recordings and a ratatui capture crate.",
  reading=["../rounds/ROUND-3.md §5", "../INTERFACES.md §10", "../VERIFIED_FACTS.md (terminal fidelity)", "../../research/brief4.md"],
  detail=["Frame schemas in `@mostra/protocol`, shared with the Rust crate.", "`@xterm/headless` replay with Unicode 11; `<TerminalGrid>` with bundled font and procedural glyphs.", "Recorded mode with scrub and markers; `term dump` and terminal lint.", "`mostra-term-capture` crate.", "`mostra term record` (a first-party CLI-command plugin), moved here from WP-25 (D122)."],
  out=["Live, WASM and compare (WP-23)"],
  risks=["ZWJ, flags and VS16 emoji disagree across engines (prototype): lint them."],
  handoff="WP-23 adds live sessions and compares frames across modes.",
),
"WP-23": dict(
  goal="Real programs live in the page, ratatui apps in WASM, and candidates compared cell by cell.",
  reading=["../rounds/ROUND-3.md §5", "../INTERFACES.md §4 (term WebSocket), §7 (pty port)", "../../research/brief4.md §1, §2, §4"],
  detail=["PTY host and `pty` port; declared sessions only; WebSocket protocol with backpressure; asciicast v3 tee.", "xterm.js 6 WebGL engine as a first-party embed-engine plugin.", "Ratzilla template and WASM island with frame reporting; zero-cell-difference proof against capture (TM-05).", "`<TerminalCompare>` and cell-rectangle comments.", "The xterm.js engine's contract proof through `mostra plugin verify`, moved here from WP-25 (D122): it is the terminal half of EX-05, which WP-25 closes for v1."],
  out=["Recorded mode (WP-22)"],
  risks=["Browsers cap WebGL contexts: virtualize off-screen terminals."],
  handoff="J4 complete.",
),
"WP-24": dict(
  goal="Projects' own apps shown as real demos, and every artifact exportable without pretending server features still work.",
  reading=["../ARCHITECTURE.md §3, §9", "../INTERFACES.md §2.2 (demos), §15", "../DECISIONS.md D28", "../../research/brief4.md §5"],
  detail=["Declared demos with lifecycle; per-demo port proxy with HTTP and WebSocket passthrough and Host rewriting; framing headers stripped for that demo only; bridge injection with opt-out.", "`<WebDemo>` with device frames and viewports.", "The `static`, `html` and `snapshot` export classes. The `bundle` class, `mostra run <bundle>` and the `WorkerLauncher` documentation moved to WP-29 (D125), which a share needs first; VR-07's bundle case reuses them."],
  out=["MCP App export (WP-17)", "The `bundle` class and `mostra run` (WP-29)", "Terminal exports (WP-22, WP-23)"],
  risks=["Next.js HMR path differs from Vite's: test both."],
  handoff="J5's embedded live demo works; every export class is proven.",
),
"WP-25": dict(
  goal="First-party plugins prove every contract, including the license flow for non-OSI engines.",
  reading=["../rounds/ROUND-3.md §6", "../DECISIONS.md D26, D31", "../VERIFIED_FACTS.md (Remotion, GSAP terms)"],
  detail=["Remotion and GSAP adapters (user-installed, `--accept-license`), chart datum anchor provider, filesystem connector.", "`mostra plugin verify` against each plugin's baselines."],
  out=["The registry (v1.x)", "`mostra term record` and the xterm.js engine's proof (WP-22 and WP-23, after the first release, D122)"],
  risks=["Never add Remotion or GSAP to any core dependency tree; the license audit enforces it."],
  handoff="J9 works.",
),
"WP-26": dict(
  goal="Agents start from excellent templates, people see what Mostra can do, and the docs are built with Mostra itself.",
  reading=["../PRODUCT.md (journeys, quality and adoption)", "../DECISIONS.md D29, D63, D68", "../REPO_STANDARDS.md §8", "../../research/brief1-second.md (gallery ideas) via the INDEX"],
  detail=["Templates per family, one-off and long-lived, each with AGENTS.md and passing verify; they include a team (roster) form and a hosted-sharing example (D121, D116).", "Gallery with prompt, source and result, including the launch demos.", "Docs site built with Mostra, generated references, per-page Markdown, `llms.txt`, deployed to GitHub Pages under `mostra-dev`; it covers remote servers, the relay, teams and the public telemetry event list (D119).", "SPA-mode completeness review (RS-02)."],
  out=["Evaluation suite (WP-27)"],
  risks=["Every example is a CI test: keep baselines committed and stable."],
  handoff="v1 is feature-complete for the closeout.",
),
"WP-27": dict(
  goal="An opt-in, paced evaluation suite that measures whether agents succeed with Mostra on the first try and keep succeeding across turns.",
  reading=["../DECISIONS.md D33, D34, D64, D72, D75", "../evaluations/eval-01/ (harness and report)", "../../research/brief6.md §1.1, §4.3"],
  detail=["Grow the EVAL-01 harness onto the real toolchain: scenarios over templates and journeys J1 to J12 and the team, hosted and relay journeys (J13, J14), first-pass verify, turns to pass, retention across turns.", "Pacing per D64, announcements per D34, records per STANDARDS.", "Re-run the base comparison on Mostra's own kit."],
  out=["Prose quality (never measured by evaluations)"],
  risks=["Model mix variety (D34): don't optimize for one model."],
  handoff="The phase closeout.",
),
"WP-28": dict(
  goal="Settle the remote server's design at the surface, so WP-29 and WP-30 build from the dossier: how a hosted artifact's data, code and identity move between the owner's instance, the remote server and an operating layer (D116, D117), recorded in the dossier with Mirza's acceptance.",
  reading=["../DECISIONS.md D06, D12, D38, D58, D61, D70, D97, D98, D104, D105 and D116 to D125", "../ARCHITECTURE.md §3, §5, §6, §7, §10, §11, §14", "../INTERFACES.md §4, §6, §7, §12, §15", "../DATA_MODEL.md (all)", "../FAILURE_MODEL.md (all)", "../../research/brief7.md (remote mode and its clients; long, so a fast-worker summary with this file named is acceptable)", "../VERIFIED_FACTS.md (MCP, remote viewing, cross-site frames, the chat hosts of 2026-10-16); re-verify the MCP authorization specification and the chat hosts' remote MCP support on the day", "Infrastructure facts Mirza provides (hosting, the user-content domain): ask for them at the start"],
  detail=["From WP-08 (D129, D130): runs already have the state `waiting` (allowed by `action_run`'s check, entered by no path yet), keys unique per artifact, function and key, and client keys for retried requests; `WorkerLauncher.launch` takes a version reference (`{ versionId, outputDigest, locator }`) and the channel carries only JSON-RPC lines, so a relay launcher fits (`test/fixtures/worker-host.mjs` is a socket launcher that proves it). Secrets reach a worker only as `server/secret` answers on the owner's instance.", 
    "This package writes design, not code. Bring Mirza each question below with what you know, the options and your recommendation, as one set (README §2); record the answers as decisions and write them into the documents the Scope names. Then refine WP-29's and WP-30's entries in WORK_PACKAGES.md and their detail here, and regenerate (D123: the surface and the options; the sessions settle the rest).",
    "1. *Where a hosted artifact's ledger is canonical.* (a) The hosted home is canonical and the owner's instance follows its events (recommended: viewers keep working while the owner sleeps); (b) the owner's ledger is canonical and the remote server caches.",
    "2. *Transport.* JSON-RPC over WebSocket, or HTTP plus SSE; account tokens from a device-code sign-in.",
    "3. *What a share pushes.* The portable bundle (ARCHITECTURE §3) with the client build and manifest; the server bundle stays with the owner under the relay.",
    "4. *Relay semantics.* A run state for \"waiting for the owner\" (additive to WP-08's run states, D124); the offline policy (`queue` with a time limit, or `fail`); idempotency keys end to end; live producers pushing from the owner.",
    "5. *Authoring from chat hosts* (D117, deferred to this package). Relayed to the owner's instance (recommended for v1), or refused when none is attached; cloud-side builds are v1.x (RM-06).",
    "6. *Hosting many homes.* One supervisor per active home, or a multi-home supervisor; idle scale-to-zero and its cold-start budget.",
    "7. *Addressing.* Wildcard per-artifact origins on the user-content domain, worker-mode frames (D70), TLS. The user-content domain and its spares are configuration (D137): new links go to the configured active domain, links already issued keep resolving on theirs, and moving new links needs no release. Where the shell lives (the user-content domain, a separate registrable domain, or the operator's domain) is part of this question; weigh it against cookie tossing (question 8).",
    "8. *Identity.* OAuth providers, the mapping to viewers (`view/url`'s `viewer`, D104), anonymous display names recorded as unverified. The user-content domain is not on the Public Suffix List at first (D137), so every hosted page is same-site with every other tenant's page and can set cookies for the parent domain: design sessions so that no page can plant, overwrite, shadow or crowd out another origin's credentials. Starting point: host-only `__Host-` cookies (`Secure`, `Path=/`, no `Domain`) or no cookies at all; never trust a cookie scoped to the parent domain; a session bound to the origin it was issued for (D98 item 1). Bring Mirza the options with a recommendation, re-verify browsers' prefix handling on the day (VERIFIED_FACTS), and give WP-30 seeded negative tests: a tossed parent-domain cookie, a cookie named to shadow a session, and a sibling filling the shared cookie jar (D98 item 9).",
    "9. *Operator ports.* The smallest surface that lets an operating layer enforce limits, receive metering, resolve accounts and act on abuse, with no-op defaults (HO-09).",
    "10. *Remote MCP.* Protocol revisions, OAuth details (client registration by metadata document and dynamically, refresh tokens), statelessness with explicit handles (D61), the tool set.",
    "11. *Self-hosting.* A container image and its configuration.",
    "Reserve in INTERFACES the client hooks and wait conditions WP-31 fills (D121), labelled *Deferred decision* for WP-31, so the remote binding is designed with them in view.",
  ],
  out=["Code: WP-29 and WP-30 build the design", "The managed service's operating layer, which lives outside this repository (D116)", "Sandboxed remote execution (RM-06, v1.x)", "Team semantics beyond reserving their surface (WP-31)"],
  risks=["The MCP authorization specification and the chat hosts' remote MCP support move quickly: re-verify both on the day and record them in VERIFIED_FACTS.", "A hosted artifact is authorized by its capability URL exactly as a local one (D06, D97); a design that needs a weaker rule is a finding for Mirza, never a shortcut.", "A public-suffix entry for the user-content domain can't be counted on (D137): the design must be safe without one, and stays safe with one."],
  handoff="A remote design Mirza accepted, in ARCHITECTURE, INTERFACES, DATA_MODEL and FAILURE_MODEL, and WP-29's and WP-30's specifications refined from it.",
),
"WP-29": dict(
  goal="An agent shares a published version to a remote server with one command; the link works while the author's machine sleeps; answers, waits and actions behave exactly as they do locally.",
  reading=["../DECISIONS.md D105, D116, D117, D124, D125", "The remote design WP-28 recorded in ARCHITECTURE, INTERFACES, DATA_MODEL and FAILURE_MODEL", "../INTERFACES.md §6, §7, §9, §15", "../FAILURE_MODEL.md §4, §6"],
  detail=[
    "WP-28 refines this specification (D123); until then it states the surface.",
    "From WP-24 (D125): the `bundle` export class, `mostra run <bundle>` and the documentation of `WorkerLauncher` as the future `SandboxPort` move here, because a share pushes the bundle (RM-01). WP-24's VR-07 evidence reuses this bundle.",
    "Remote submissions reach the host through the local outbox, so H-04's guarantees (durable before delivery, ordered, idempotent replay) hold for hosted artifacts too.",
    "Sign-in, sign-out and sharing commands join the CLI additively (D60); their help text is drafted with Mirza (D74).",
    "The relay's \"waiting for the owner\" is an additive state of WP-08's action runs (D124); secrets never cross the relay (D117).",
    "From WP-08 (D135): a version's server code imports its packages by name and runs them from the layout of its `lock.yaml` (or the warm set). A remote launcher installs the bundle's lockfile into its own layout before the worker starts and passes it as `--modules`; the test worker host (`packages/runtime/test/fixtures/worker-host.mjs`) shows the shape.",
  ],
  out=["The remote server's multi-home mode, viewer sign-in, operator ports and remote MCP (WP-30)", "Sandboxed remote execution (RM-06, v1.x)", "Team features (WP-31)"],
  risks=["Exactly once in effect across two ledgers: every relayed call and every synced submission carries a stable ID end to end (FAILURE_MODEL §1 rule 3).", "Secrets never cross the relay: grep tests over relay traffic, as WP-08's over logs and events."],
  handoff="Hosted links whose answers and actions flow back to the owner; WP-30 turns the endpoint fixture into the full remote server.",
),
"WP-30": dict(
  goal="A self-hostable remote server that serves many homes safely on a separate user-content domain, signs viewers in, lets an operating layer enforce its limits through ports, and gives cloud chat hosts a remote MCP server, so inline artifacts persist there.",
  reading=["../DECISIONS.md D06, D61, D70, D97, D116, D118", "The remote design WP-28 recorded", "../INTERFACES.md §4, §5, §7, §12", "../../research/brief7.md §1, §2 (client limits)", "../VERIFIED_FACTS.md (MCP, the chat hosts of 2026-10-16; re-verify)"],
  detail=[
    "WP-28 refines this specification (D123).",
    "Multi-home mode behind one gateway; per-artifact origins on the user-content domain, with worker-mode frames (D70).",
    "Operator ports with no-op defaults, so a self-hoster needs no operating layer; the managed service's operating layer reaches the server only through them (D116, HO-09).",
    "The remote MCP endpoint serves WP-15's transport-independent tool handlers over Streamable HTTP with OAuth (MC-04), so WP-17's MCP Apps persist in cloud chat hosts.", "Check boundary for MC-04 (D125 puts this package before WP-17): prove the endpoint, its authorization and an agent in a cloud chat host creating, opening (through the full-page link) and submitting an artifact. The MCP App exporter, its client transport and the app-only tools are WP-17's; WP-17 repeats the check inline through this server. Build nothing WP-17 would have to work around: the app-only tools of INTERFACES §12 are served by the same handlers.",
    "The report control renders in the shell's origin like every trusted control (invariant 7); policy hooks add an interstitial and an expiry to public links (HY-09).",
    "A container image and self-hosting docs; RM-03's audit shows no operating-layer code in the core.",
  ],
  out=["The managed service's operating layer: accounts, billing, quotas, metering storage, abuse tooling and fleet operation (outside this repository, D116)", "`ee/` features (D118)", "Sandboxed remote execution (RM-06, v1.x)"],
  risks=["ChatGPT's write tools on a custom MCP server need a Business or Enterprise workspace, and approved tool snapshots freeze (VERIFIED_FACTS, 2026-10-16): arrange the external check with Mirza early, and keep schemas additive (D32).", "Cross-tenant isolation is hygiene: seeded cross-tenant reads, writes and frame entries are negative tests, as WP-05's are."],
  handoff="Hosted links on a real remote server, and inline Mostra that persists in cloud chat hosts; WP-31 builds team features on its viewer identity.",
),
"WP-31": dict(
  goal="Send one artifact to a team and know who answered: expected respondents with personal links, waits for everyone, and respondent status, presence and attribution as data any page shows in its own design.",
  reading=["../DECISIONS.md D39, D47, D63, D97, D103, D104, D107, D121", "../INTERFACES.md §2.3, §4, §6", "../DATA_MODEL.md §3, §4", "../FAILURE_MODEL.md §5", "The remote design WP-28 recorded (viewer identity)"],
  detail=[
    "The surface and the options (D123); the session settles names and semantics and records them as delegated decisions.",
    "Roster: people named by the host's stable viewer reference (`view/url`'s `viewer`, D104) and display name, or by email where a remote server sends invitations; locally one personal link per respondent.",
    "Waits: options include conditions such as `submitted:all` and `submitted:<N>`, defined under `once` per-viewer (D107) and `epochs` (D103), with an event when the roster completes.",
    "Hooks: options include `useRespondents()` and `usePresence()`; respondent status also through the host protocol and the CLI.",
    "Presence and cursors are ephemeral (D47): never stored, rate-limited and coalesced, and off unless the artifact opts in. The shell imposes no presence UI (D121).",
    "Attribution: who last changed each artifact-scoped field and when, readable by the page.",
    "Visibility (CO-07): owners, agents and hosts always see respondent status. What viewers see of each other by default is a *Deferred decision* for this package with Mirza; recommendation: private unless the artifact opts in.",
    "Team scenarios join the conformance kit (WP-12).",
  ],
  out=["Real-time co-editing of text (the v1.x Yjs plugin)", "Kit components for teams (WP-19, KT-11)", "Mentions in comments (WP-20, CO-06)", "Roles and permissions beyond capability scopes"],
  risks=["Presence must never reach the ledger or the event log: a test asserts it (CO-04).", "Roster waits are level- or edge-triggered like D103 and D107: property-test the interleavings."],
  handoff="Team forms and live team pages work end to end; WP-19 and WP-20 add the kit components and mentions on these hooks.",
),
"WP-W1": dict(
  goal="The supervisor, ledger, builder and dependency store run natively on Windows x64 and arm64 with the guarantees they give on macOS and Linux: one owner per home, an owner-only home and transport, and every child process tracked and reaped.",
  reading=["../DECISIONS.md D18, D35, D44, D45, D62, D81, D82, D85, D86, D87, D93, D120, D146", "../ARCHITECTURE.md §4", "../FAILURE_MODEL.md §2, §3, §10", "../DATA_MODEL.md §3 (`child.start_time`)", "../REPO_STANDARDS.md §6, §9", "../VERIFIED_FACTS.md (process model, WP-02 and WP-08); verify every Windows fact you rely on and record it there"],
  detail=[
    "The surface and the options (D123); the session settles the rest and records it as delegated decisions. Re-derive FAILURE_MODEL §2's guarantees for Windows rather than porting the Unix code paths; every place that assumes POSIX (modes, signals, process groups, `ps`, `/proc`, socket paths) is found by audit and listed in the progress report.",
    "Platform layer: one module owns the platform differences, so the rest of the runtime asks it rather than testing `process.platform`. The home and runtime directory default under `%LOCALAPPDATA%`; D44's environment overrides keep working.",
    "Owner-only access (D44, D85, D140): NTFS access control lists that grant only the current user (and SYSTEM where Windows requires it), set at creation, in place of `0600` and `0700`, and checked when a directory is reused. Options: a small Rust helper in `crates/` called by the runtime, a native addon, or `icacls` at creation; recommendation: the helper, which W1's process model needs anyway.",
    "Files: Windows refuses to rename or delete an open file. Staging, the sealed version store, the dependency store and GC close files before renaming them, retry sharing violations briefly, and never leave a half-written entry; the ledger's exclusive lock (D81) is re-checked under Windows file locking; long paths (the `\\\\?\\` prefix) and case-insensitive names are handled in the version store and the dependency store.",
    "Home transport (D81, D82): Node's `net` serves Windows named pipes. Compare a per-home pipe whose access list admits only the current user (and rejects remote clients) with loopback TCP plus a token file in the owner-only home; recommendation: the named pipe. Racing starters converge on one supervisor and a dead owner is recovered, as RT-06 requires.",
    "Process model (D45, RT-09): each child in a Job Object, so its descendants close with it, in place of process groups; identity by PID and creation time (`GetProcessTimes`) in place of `/proc` and `ps`; the startup reaper finds and ends the processes a crashed supervisor left, grandchildren included. D93's gated launch is re-derived for Windows. Graceful shutdown (D87) travels over the control channel, because Windows has no SIGTERM. Options for the Job Object calls: the Rust helper or a native addon; recommendation: the helper.",
    "The builder and the dependency store (WP-03, WP-04): the private pnpm, native prebuilds for win32 x64 and arm64, links in place of symlinks where Windows needs them, and the warm set.",
    "The platform gate admits win32 x64 and arm64 only behind a development switch that the CI legs set, so no release exposes a partial Windows; other platforms fail closed as before, and RT-07's simulated platform becomes one that stays unsupported. The switch's name is a *Deferred decision* for this package.",
    "CI: Windows legs (`windows-latest`, and an arm64 runner where one is available) in the unit and integration jobs for WP-01 to WP-04's suites.",
  ],
  out=["The gateway, workers, verify and the CLI on Windows (WP-W2)", "Bundles, the SDK, the Rust crate and conformance on Windows (WP-W3)", "Terminal features on Windows (ConPTY), which wait for WP-22 and WP-23"],
  risks=["Windows signals, process groups and file locking differ in kind, not in detail: a port that only translates calls will pass simple tests and fail under races. Test the races (sixteen starters, a kill during publish, a kill with grandchildren).", "Antivirus scanners hold files open briefly after they are written; rename and delete paths must tolerate it without weakening atomicity.", "GitHub's Windows runners are slower: keep each job inside D50's target by grouping, as the integration job does."],
  handoff="A supervisor that runs on Windows with the same guarantees; WP-W2 brings the gateway, workers, verify and the CLI onto it.",
),
"WP-W2": dict(
  goal="Everything a person and an agent touch locally works on Windows as on macOS and Linux: the gateway, workers and actions, `verify`, the CLI and the login service.",
  reading=["../DECISIONS.md D21, D45, D50, D62, D93, D119, D146", "../ARCHITECTURE.md §4, §5", "../INTERFACES.md §9 (CLI)", "../FAILURE_MODEL.md §2, §10", "WP-W1's progress report and delegated decisions"],
  detail=[
    "The surface and the options (D123); the session settles the rest and records it as delegated decisions.",
    "Gateway and addressing: loopback binds, port leases reused across restarts (D62), and per-artifact origins behave as on Unix; Windows Firewall prompts never appear for loopback-only binds (a check).",
    "Workers, actions and live data run under WP-W1's process model, with D62's memory limit and watchdog; a crashing, an out-of-memory and a busy-looping worker are contained as RT-04 requires.",
    "`verify` drives its headless Chromium on Windows, fetched at setup as on the other platforms (D142).",
    "CLI: `open` launches the default browser; `dev` watches files with Windows paths and editors' save patterns; telemetry keeps its store and consent under the Windows home (D119, D140).",
    "Login service (RT-08): compare a per-user Task Scheduler task at logon with the per-user Run registry key; recommendation: Task Scheduler, which restarts on failure and needs no elevation. `daemon install` and `daemon uninstall` leave nothing behind.",
    "The secret store keeps owner-only access on Windows (WP-W1's access lists).",
    "CI: Windows legs in the integration and e2e jobs.",
    "From WP-W1 (D150, its progress report's POSIX audit): the platform layer (`@mostra/runtime`'s `platform`) is where each Windows difference goes, never a `process.platform` test elsewhere (a unit test refuses it); every child already runs behind `mostra-win gate` in a Job Object, so workers and the verify runner need only their crash kinds re-derived (Windows reports exit codes, not `SIGABRT` or `SIGKILL`) and their own `kill(-pid)` on disconnect made a no-op; secrets and capability keys already inherit the home's owner-only access list, which the secret store's check proves; add the gateway's, workers', verify's and the CLI's suites to the `windows` integration group and `WINDOWS_PACKAGES`. The CLI reaches the daemon's pipe only through the runtime's `connectControl` (or `mostra-win connect`), which refuses a pipe another user created under the name `instance.json` names (WP-W1's Opus review): a plain `net.connect` would hand that user the CLI's requests.",
  ],
  out=["Bundles, the SDK, the Rust crate and conformance on Windows (WP-W3)", "Terminal features on Windows"],
  risks=["Browser and file-watching tests are where Windows flakes appear: fix the cause (a missed save event, a slow start) rather than retrying."],
  handoff="Mostra works on Windows from source; WP-W3 ships it to people who install it.",
),
"WP-W3": dict(
  goal="People on Windows install and use Mostra the way people on macOS and Linux do: one command, no global Node, verified bundles, and hosts in TypeScript or Rust.",
  reading=["../DECISIONS.md D18, D91, D142, D146", "../INTERFACES.md §16, §17", "../REPO_STANDARDS.md §6, §9", "WP-11's and WP-12's progress reports", "WP-W1's and WP-W2's progress reports and delegated decisions"],
  detail=[
    "The surface and the options (D123); the session settles the rest and records it as delegated decisions.",
    "Runtime bundles for win32 x64 and arm64: the private Node, the native prebuilds, and D142's verification; the verify browser is fetched at setup, never shipped. The license audit covers each bundle (`--bundle`).",
    "`create-mostra`, the SDK's platform gate and bundle download, and the release pipeline produce and publish the Windows bundles with the others.",
    "The Rust host crate spawns and attaches over the Windows transport; the Rust and TypeScript reference hosts pass the conformance kit on Windows.",
    "The development switch from WP-W1 (`MOSTRA_DEV_WINDOWS`, D150) is removed: Windows is supported, and RT-07's fail-closed check covers the platforms still unsupported.",
    "From WP-W1 (D150): the bundles carry `mostra-win.exe` in `bin/` (the runtime finds it there), built for each architecture; the SDK and the Rust crate attach over the pipe `instance.json` names, and refuse it unless its owner is the user (the SDK through `mostra-win connect`, the crate with `GetSecurityInfo` on its handle, opened with `SECURITY_IDENTIFICATION`), since another user can create a pipe under a name no instance serves (WP-W1's Opus review); the bundle's launchers become `.cmd` or executables.",
    "Docs: installation, the host guides and troubleshooting cover Windows.",
    "From this package on, every package keeps the Windows legs green (for example WP-13's tunnel binaries and WP-14 and WP-15's host configuration paths).",
  ],
  out=["A native installer or package-manager listing (winget, Scoop): later, once the npm path is proven", "Terminal features on Windows"],
  risks=["Windows arm64 runners and prebuilds are the least tested combination: verify each native dependency's arm64 prebuild on the day and record it in VERIFIED_FACTS."],
  handoff="Windows is a supported platform; WP-13 and every later package keep it green.",
),
}

ALWAYS = "Plus the files every WP reads ([README.md](README.md) §1)."


def blocks(text):
    """Yield (section title, package block) for every `### WP-NN.` block of WORK_PACKAGES.md. A block ends
    at the next `### ` or `## ` heading, so a level-2 heading after a package (such as "After the first
    release") never becomes part of that package's text."""
    for section in re.split(r"^## ", text, flags=re.M):
        title = section.split("\n", 1)[0].strip()
        for b in re.split(r"^### ", section, flags=re.M)[1:]:
            yield title, b


AFTER_FIRST_RELEASE = "After the first release"


def main():
    req_rows, owners = load()
    text = (D / "WORK_PACKAGES.md").read_text()
    out_dir = D / "work-packages"
    out_dir.mkdir(exist_ok=True)
    seen = []
    stale = []
    for section, b in blocks(text):
        head, body = b.split("\n", 1)
        m = re.match(r"(WP-(?:\d\d|W\d))\. (.+)", head)
        wp, title = m.group(1), m.group(2).strip()
        seen.append(wp)
        if wp not in DETAIL:
            sys.exit(f"{wp} is in WORK_PACKAGES.md but has no DETAIL entry in tools/design/wp_specs.py")
        det = DETAIL[wp]
        owns = re.search(r"^- \*\*Owns:\*\* (.+)\.$", body, re.M).group(1).split(", ")
        builds = re.search(r"^- \*\*Builds:\*\*(.*?)(?=^- \*\*Depends on)", body, re.M | re.S).group(1).strip()
        depends = re.search(r"^- \*\*Depends on:\*\* (.+)$", body, re.M).group(1)
        evidence = re.search(r"^- \*\*Evidence:\*\*(.*)$", body, re.M | re.S).group(1).strip()
        L = [f"# {wp}. {title}", "",
             f"<!-- Generated by tools/design/wp_specs.py. Edit WORK_PACKAGES.md or the generator, then regenerate. -->", "",
             "| | |", "|---|---|",
             f"| **Mode** | `PROGRAM MODE: work-package`, `WORK PACKAGE: {wp}` |",
             f"| **Depends on** | {depends} |"]
        if section == AFTER_FIRST_RELEASE:
            L.append("| **Release** | v1.1, after the first release (D122) |")
        L += [f"| **Branch** | `wp/{wp[3:].lower()}-<short-name>` from the accepted predecessor |",
             f"| **Protocol** | [README.md](README.md) |", "",
             "## Goal", "", det["goal"], "",
             "## Owned requirements", "",
             "Close each with the check below, through the real public interface (README §3).", "",
             "| ID | Requirement | Route | Concrete check |", "|---|---|---|---|"]
        for rid in owns:
            r = req_rows[rid]
            L.append(f"| {rid} | {r['text']} | {r['route']} | {CHECKS[rid]} |")
        rebase = lambda t: re.sub(r"\]\((?!https?:|\.\./|#)([^)]+)\)", r"](../\1)", t)
        L += ["", "## Scope", "", "From [WORK_PACKAGES.md](../WORK_PACKAGES.md):", "", rebase(builds.replace("\n  ", "\n")), "",
              "Design detail for this package:", ""]
        L += [f"- {x}" for x in det["detail"]]
        L += ["", "## Out of scope", ""] + [f"- {x}" for x in det["out"]]
        L += ["", "## Required reading", "", ALWAYS, ""] + [f"- {x}" for x in det["reading"]]
        L += ["", "## Acceptance evidence", "", rebase(evidence.replace("\n  ", "\n")), "",
              "Also: `pnpm check` green, diff reviewed, the progress report's evidence table complete for every owned requirement (README §3), the evidence matrix regenerated, docs and AGENTS.md current, and the report finalized after acceptance (README §4)."]
        L += ["", "## Risks and notes", ""] + [f"- {x}" for x in det["risks"]]
        if det.get("publication"):
            L += ["", "## Publication", "", det["publication"]]
        L += ["", "## Handoff", "", det["handoff"], ""]
        text = "\n".join(L)
        target = out_dir / f"{wp}.md"
        if "--check" in sys.argv:
            if not target.exists() or target.read_text() != text:
                stale.append(wp)
        else:
            target.write_text(text)
    missing = set(DETAIL) ^ set(seen)
    if missing:
        sys.exit(f"detail and WORK_PACKAGES disagree: {sorted(missing)}")
    if stale:
        sys.exit(f"stale WP specifications {stale}: run python3 tools/design/wp_specs.py")
    print("checked" if "--check" in sys.argv else "wrote", len(seen), "specifications")


if __name__ == "__main__":
    main()
