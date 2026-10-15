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
  detail=["From WP-06 (D101): `signal()` in `@mostra/server` raises through the interaction core's `raiseSignal` with `source: \"action\"` and the run as causation; results' `actions` list the runs started in the submission's view (empty until then), and the Markdown golden already renders them. A server-side `state` write is `applyMutation` with an agent actor and its own mutation ID.", "Worker: loads the version's server bundle, executes calls inside AsyncLocalStorage, never sees cookies or tokens; WorkerLauncher as the seam.", "Serializer with a conformance suite mirroring React's documented Server Function types plus AsyncIterable.", "Runs: recorded before start, keys unique per artifact and action, join semantics, cancel, `interrupted` on crash, 1 MB log cap.", "Live sources: producers per D56/D63 with persisted latest value, ring buffer, pushes; ephemeral delivery.", "Lifecycle: watchdog, heap limit, idle eviction, backoff, parking; port leases for artifacts with server code.", "Five RSC seam tests (RS-01).", "Extend WP-03's RT-02 process audit (`packages/runtime/test/integration/audit.test.ts`) to action calls and live producers, and load WP-03's server bundle (`server/entry.mjs` with the function registry); replace the client runtime's unavailable server-call transport with the real one (D93).", "WP-05's gateway declares `call/{fnId}`, `runs` and `runs/{id}/cancel` with the `action:<name>` scope rule of D97 item 4 (`action:*`, `action:<export>`, `action:<module path>#<export>`): attach the handlers there, check `runs`' function ID against the session's scopes, and repeat WP-05's scope test with a real action (a view-only link can't run it). Strip Mostra's cookies before forwarding to the worker (D38). Keep WP-05's RT-05 test green: a worker starts only for a version with server code (D96)."],
  out=["Verify's use of dry-run (WP-09)"],
  risks=["Effects of a run killed mid-flight: document provider idempotency keys in the Skill references."],
  handoff="J3's inbox works: real Send, once per click, progress, secrets out of every artifact output.",
),
"WP-09": dict(
  goal="The decisive feature: one command that tells a blind agent, in stable JSON, whether its artifact builds, renders, works and still does what it did last time.",
  reading=["../ARCHITECTURE.md §12", "../INTERFACES.md §13", "../rounds/ROUND-3.md §9", "../evaluations/eval-01/EVAL-01.md (checker lessons, D72)", "../../research/brief6.md §2 (pipeline, token budget)", "../FAILURE_MODEL.md §9"],
  detail=["Stages in order with early exit on compile failure; warm browser in the verify runner child.", "Severity rule from D72: smoke observations without a runtime error are warnings; hover-opened and already-active controls classified before judging; never click through actions that didn't opt into `dryRun()`.", "Regression baseline: the last passing version's ARIA snapshot, pixels and contracts (fields, actions, live sources).", "Cached verdict by source and env digest; publish gate with `--force` recording codes.", "Screenshot token estimates for Claude, GPT and Gemini formulas (brief 6).", "Readiness: boot and render wait on the Mostra readiness signal and server health, never on fixed sleeps (EVAL-01b found a start-up race in a sleep-based checker).", "Run `verify` on WP-03's AU-01 and AU-02 fixtures and extend its RT-02 process audit to verify runs; regression baselines come from the version source snapshots of VR-11 (D93).", "Verify resolves packages exactly as publish does, through WP-04's `Dependencies.resolve` with the same working-lockfile key (D95), so its cached verdict's `envDigest` (which includes `lockDigest`) matches the publish that follows; `MOSTRA_DEP_*` diagnostics are compile-phase verdict entries."],
  out=["Kit-specific lint rules (WP-18), terminal lint (WP-22)"],
  risks=["False positives make agents break working code (EVAL-01): every new check needs a negative fixture proving it doesn't fire on correct code."],
  handoff="Agents can iterate to `pass` and publish safely.",
),
"WP-10": dict(
  goal="The CLI agents use every day: every capability through one thin client, predictable JSON, exit codes and no prompts.",
  reading=["../INTERFACES.md §6, §9", "../DECISIONS.md D60", "../rounds/ROUND-2.md §3.1", "../FAILURE_MODEL.md §2 (version skew)"],
  detail=["From WP-06 (D101): `mostra wait`, `results` and `state get|set|patch` are thin clients of `wait`, `results/get` and `state/*` (exit code 5 for `still_waiting`, 6 for `MOSTRA_SUBMIT_ALREADY` and conflicts); `mostra gc --compact-events --before <cursor>` calls the interaction core's `compactEvents` per artifact in one transaction, and its reads already answer `MOSTRA_HOST_CURSOR_COMPACTED`. IN-10's CLI check is closed here.", "Thin protocol client with daemon autostart and attach; NDJSON for streams.", "`mostra dev`: Vite HMR on a separate port, never reachable through capability URLs (VR-08).", "`doctor`, `gc` (reference rules, dry run), `docs`, `state`, `run`.", "Help text generated from command definitions; the wording is drafted with Mirza (D74).", "`mostra dev` implements `RenderMode.dev` (ROUND-3 §7) beside WP-03's `build`, on the same SPA build settings.", "`mostra add <package…> [--artifact <path|id>]` is the client of WP-04's `deps/add` (D95), defaulting to the artifact in the current directory; `MOSTRA_DEP_MISSING`'s fix already carries that exact command, so add a contract test that runs the command a diagnostic names. `mostra dev` resolves packages through the same `Dependencies.resolve`.", "`gc` also collects WP-04's dependency state (D95): lock layouts in `deps/locks` that no working lockfile (`dependency_lock`) and no kept version's `lock.yaml` names, then `pnpm store prune` through the install child (pnpm 10, D94), removing the pruned packages from `dependency_package`; never while an install runs.", "`mostra doctor` closes LL-05's doctor half (D96): it warns when the home has artifacts with submission policy `none` (read through `artifact/list`) and no always-on daemon, which is the login-service unit WP-08's `mostra daemon install` writes for the home; extend WP-05's LL-05 evidence row with that check.", "Add `mostra dev` to WP-05's VR-03 route enumeration (`packages/runtime/test/integration/routes.test.ts`, D96): no viewer URL reaches the dev server or the source it serves.", "`mostra open` and `mostra publish` print the capability URL; `mostra open --rotate` and `--revoke` are clients of `view/rotate` and `view/revoke` (D97)."],
  out=["`share` drivers (WP-13)", "`mcp` (WP-15)", "`plugin` (WP-16)", "`term` (WP-22)", "`export` classes beyond the receipt (WP-24)"],
  risks=["Keep the CLI free of logic the protocol lacks: anything a host can't do through the protocol is a protocol gap to fix."],
  handoff="J1 runs end to end from a terminal.",
),
"WP-11": dict(
  goal="Users never install Node, hosts download one verified bundle, JavaScript hosts embed Mostra in a few lines, and releases publish themselves.",
  reading=["../ARCHITECTURE.md §4 (distribution)", "../REPO_STANDARDS.md §9", "../INTERFACES.md §6, §7", "../DECISIONS.md D18, D36, D67", "../VERIFIED_FACTS.md (publishing)"],
  detail=["From WP-06 (D101): the SDK's `wait`, `results` and `events` wrap the host methods, and its `submissions` port answers `port/submissions.deliver`; IN-10's SDK check is closed here, along with an SDK host receiving a delivery.", "Bundles for macOS arm64/x64 and Linux x64/arm64: Node LTS (24, or 26 after 2026-10-28), prebuilt code, warm set, headless Chromium, native modules; SHA-256 manifest and GitHub artifact attestation.", "Ship the warm set as the pre-built, read-only layout WP-04 links (`@mostra/warm`'s `node_modules`, found beside the runtime or through `MOSTRA_WARM_DIR`), and pnpm 10 beside the runtime as the install child's installer (D94; the license audit refuses pnpm 11 or later and `@pnpm/exe.*`). Lock layouts in a home link the warm set by path, so a bundle at a new path relinks them on use (WP-04 does it).", "Download, verify, cache by hash; `npm create mostra`; `@mostra/cli` bootstrap selecting the bundle.", "`@mostra/sdk` `createMostra({ home, ports })` over the spawned instance.", "Release workflow and exact account instructions for Mirza (npm org, trusted publishers per package, disallow tokens, crates.io); verify the first-crate-token hypothesis."],
  out=["Rust crate (WP-12)"],
  risks=["Trusted-publisher configurations expire if unused for 2 days: configure them right before the first release."],
  handoff="Anyone can install Mostra; releases flow from merged release PRs.",
),
"WP-12": dict(
  goal="Hosts in Rust integrate without touching Mostra, and every host can prove its integration with a kit.",
  reading=["../INTERFACES.md §6, §7, §8", "../JCODE_HOST.md (all)", "../FAILURE_MODEL.md §4", "../../research/brief6.md §3.3, §4.4 (Rust codegen limits, conformance precedent)"],
  detail=["From WP-06 (D101): conformance scenarios for IN-06 (drafts arrive only through `port/drafts.mirror`, labelled `kind: \"draft\"`), IN-07 (each policy), IN-08 (filtered subscribe, ack, resume after restart), IN-09 (signals as `signal.raised`, nothing woken by Mostra), IN-10 (wait level and edge, timeout cursors), IN-12 (host down, ordered replay, redelivery with the same `deliveryId`) and LL-02 (policy `none`), against WP-06's real methods.", "typify wire types from the draft-07 schema, committed with a snapshot test; hand-written tokio client; spawn and attach; bundle cache; port traits.", "`@mostra/conformance`: scenarios listed in the WP summary plus one per JCODE_HOST row; expected-failure baselines; reference hosts in Rust and TypeScript.", "Audit for host-specific code in the core."],
  out=["Jcode's own adapter (C03-B)"],
  risks=["typify is Draft-7-centric: keep the schema inside the subset it handles and fail CI when a schema leaves it."],
  handoff="C03-B has everything except tailnet sharing and the Skill, which WP-13 and WP-14 add.",
),
"WP-13": dict(
  goal="Viewing from anywhere the user chooses, never implicitly public: tailnet with identity, public shares behind explicit flags and short-lived tokens, and frames that work cross-site.",
  reading=["../ARCHITECTURE.md §5, §10", "../DECISIONS.md D38, D47, D70", "../VERIFIED_FACTS.md (Tailscale, Cloudflare, PSL, frame sessions)", "../FAILURE_MODEL.md §8"],
  detail=["`tailscale serve` and `funnel` driven when installed; identity headers mapped through the identity port; backend stays on loopback.", "Funnel port plan (443 shell, 8443 and 10000 artifacts).", "`cloudflared` quick tunnels with worker-mode frames; long-poll transport where SSE fails.", "Worker mode: bootstrap page, service worker at `/` with `Service-Worker-Allowed`, ticketed streams and WebSockets, diagnostic on conflicting registration; investigate the one-off Firefox install timeout from the prototype.", "WP-05's addressing module already picks the frame-session mode per origin pair (different hosts mean worker mode, D98) and its gateway declares `/_mostra/sw.js`, `/_mostra/v/{rev}/ticket` and the stream routes; build worker mode behind them. Registered tunnel hostnames join the gateway's exact Host allowlist through the addressing module."],
  out=["Remote mode server (v1.x)"],
  risks=["External evidence needs a tailnet device and a phone: arrange with Mirza early in the session."],
  handoff="J8 works; C03-B's remote-link need (H-14) is met.",
),
"WP-14": dict(
  goal="Agents reach for Mostra whenever they want to communicate visually, and know the loop that leads to a verified, published artifact.",
  reading=["../DECISIONS.md D29, D69, D74", "../rounds/ROUND-4.md part B", "/Users/mirzabicer/skills-temp/writing-for-agents/SKILL.md and SKILL-MECHANICS.md", "../../research/brief6.md §1, §3.4", "Every package AGENTS.md written so far"],
  detail=["`skills/mostra/SKILL.md` under about 5,000 tokens with the single trigger (D69), the core loop and pointers to references; references for every API built so far.", "Root `AGENTS.md` final text and the scaffolded artifact `AGENTS.md` used by `mostra new`.", "Harness-plugin generator producing real copies for Claude Code, Codex, Gemini CLI, Cursor and Copilot.", "Prose iterated with Mirza until accepted; mechanism tests may use placeholder text."],
  out=["MCP descriptions (WP-15)", "Later reference updates (each WP adding API)"],
  risks=["Never test prose by phrase matching (STANDARDS)."],
  handoff="The C03-B threshold (D73): Jcode can integrate.",
),
"WP-15": dict(
  goal="Any MCP client can author, verify, publish, wait for and read Mostra artifacts through a small, stateless tool set.",
  reading=["../INTERFACES.md §12", "../DECISIONS.md D32, D61", "../../research/brief6.md §3.2", "../../research/brief7.md §1, §2 (client limits)", "../VERIFIED_FACTS.md (MCP SDK v2, spec revisions)"],
  detail=["v2 TypeScript SDK packages; stdio and Streamable HTTP with the full hygiene checklist on HTTP.", "HY-01 item 13 (D96): apply `@mostra/protocol`'s `hygiene` checks, the same functions the gateway uses (exact Host, exact Origin, JSON content type, request-target and header sanity), to every HTTP request of `mostra mcp --http`, bind loopback by default, and prove each with a negative test; record the result as an extension of WP-05's HY-01 evidence row.", "Tools of INTERFACES §12; `artifact_wait` capped at 50 s; resources; tool names short and stable.", "Tool descriptions drafted with Mirza (D74)."],
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
  detail=["Exporter plugin: single-file `ui://` resource, declared CSP, token-to-host variable mapping.", "Client runtime MCP Apps transport over app-only tools; memory routing.", "Explicit degradation messages (MC-03)."],
  out=["Remote MCP for cloud chat hosts (v1.x)"],
  risks=["Host quirks per client: record per-host results as external evidence."],
  handoff="D17's three interfaces are complete.",
),
"WP-18": dict(
  goal="A beautiful baseline any agent gets for free and any agent can override completely: two bases, one token system, forms and questionnaires on fields, and guidance against churned APIs.",
  reading=["../rounds/ROUND-3.md §1", "../DECISIONS.md D26, D27, D48, D68, D72, D75", "../evaluations/eval-01/EVAL-01.md (and EVAL-01b when recorded)", "../../research/brief3.md"],
  detail=["Per-base registry packs (Base UI default, Radix), resolution without copying, `mostra add` copying.", "OKLCH tokens with dark mode, host brand themes and MCP Apps variable mapping.", "Questionnaire and form components on `useField`.", "Churn guidance and lint autofixes, including `MOSTRA_KIT_WRONG_BASE` from the TS2322 shape seen in EVAL-01 controls.", "Check EVAL-01b's result before setting the default (D75)."],
  out=["Data and visualization wrappers (WP-19)"],
  risks=["The Base UI template's `scroll-area.tsx` failed `tsc` out of the box (VERIFIED_FACTS): run the packs through Mostra's strict type-check in CI."],
  handoff="Kit visuals for every later kit package to build on.",
),
"WP-19": dict(
  goal="Every D26 library is one import away, themed by the tokens, and the live chart stays smooth at high rates.",
  reading=["../rounds/ROUND-3.md §1.2", "../../research/brief3.md §2, §3", "../VERIFIED_FACTS.md (kit versions; re-verify)", "../DECISIONS.md D26, D48"],
  detail=["Token-aware wrappers per library; warm set versus on-demand per D65.", "uPlot live chart on `useLive` append mode; set and measure the target rate (at least 60 updates per second with 10k points on CI hardware).", "License and version re-verification recorded in VERIFIED_FACTS."],
  out=["Motion and decks (WP-21)"],
  risks=["TanStack Table 9 and Mermaid 12 are new majors: add churn guidance."],
  handoff="J2's dashboard has every chart it needs.",
),
"WP-20": dict(
  goal="Review over any content, in a shell the artifact can't touch, with anchors agents can act on, and the shell's final design.",
  reading=["../ARCHITECTURE.md §8", "../rounds/ROUND-3.md §2, §8", "../INTERFACES.md §5, §8", "../DECISIONS.md D23, D47, D65, D68", "../rounds/round4-shell/ and ../rounds/ROUND-4.md part A", "../../research/brief5.md §2"],
  detail=["From WP-06 (D101): results' `comments` (threads with anchors and crop paths) and `choices` labels come from the review layer; the Markdown renderer and its golden already show them, so the review layer fills the snapshot and `buildResults` reads it.", "Overlay, threads (reply, resolve, reopen), multi-layer anchors with crops through the capture port.", "Anchor providers for charts, slides and timelines; bridge injection for served frames.", "Review sets: gallery, focus, synchronized compare with pixel diff, trusted Choose.", "`review export`.", "Final visual pass on the shell with design-focused review (ask Mirza for design skills); mobile layout.", "Review endpoints live on the shell origin under `/a/<artifactId>/_mostra/`, behind WP-05's shell-session, Origin and CSRF checks and the `review` scope (D97, D98)."],
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
  detail=["Frame schemas in `@mostra/protocol`, shared with the Rust crate.", "`@xterm/headless` replay with Unicode 11; `<TerminalGrid>` with bundled font and procedural glyphs.", "Recorded mode with scrub and markers; `term dump` and terminal lint.", "`mostra-term-capture` crate."],
  out=["Live, WASM and compare (WP-23)"],
  risks=["ZWJ, flags and VS16 emoji disagree across engines (prototype): lint them."],
  handoff="WP-23 adds live sessions and compares frames across modes.",
),
"WP-23": dict(
  goal="Real programs live in the page, ratatui apps in WASM, and candidates compared cell by cell.",
  reading=["../rounds/ROUND-3.md §5", "../INTERFACES.md §4 (term WebSocket), §7 (pty port)", "../../research/brief4.md §1, §2, §4"],
  detail=["PTY host and `pty` port; declared sessions only; WebSocket protocol with backpressure; asciicast v3 tee.", "xterm.js 6 WebGL engine as a first-party embed-engine plugin.", "Ratzilla template and WASM island with frame reporting; zero-cell-difference proof against capture (TM-05).", "`<TerminalCompare>` and cell-rectangle comments."],
  out=["Recorded mode (WP-22)"],
  risks=["Browsers cap WebGL contexts: virtualize off-screen terminals."],
  handoff="J4 complete.",
),
"WP-24": dict(
  goal="Projects' own apps shown as real demos, and every artifact exportable without pretending server features still work.",
  reading=["../ARCHITECTURE.md §3, §9", "../INTERFACES.md §2.2 (demos), §15", "../DECISIONS.md D28", "../../research/brief4.md §5"],
  detail=["Declared demos with lifecycle; per-demo port proxy with HTTP and WebSocket passthrough and Host rewriting; framing headers stripped for that demo only; bridge injection with opt-out.", "`<WebDemo>` with device frames and viewports.", "Export classes and `mostra run <bundle>`; document `WorkerLauncher` as the future `SandboxPort`."],
  out=["MCP App export (WP-17)"],
  risks=["Next.js HMR path differs from Vite's: test both."],
  handoff="J5's embedded live demo works; remote mode has its portable package.",
),
"WP-25": dict(
  goal="First-party plugins prove every contract, including the license flow for non-OSI engines.",
  reading=["../rounds/ROUND-3.md §6", "../DECISIONS.md D26, D31", "../VERIFIED_FACTS.md (Remotion, GSAP terms)"],
  detail=["Remotion and GSAP adapters (user-installed, `--accept-license`), chart datum anchor provider, filesystem connector, `mostra term record`.", "`mostra plugin verify` against each plugin's baselines."],
  out=["The registry (v1.x)"],
  risks=["Never add Remotion or GSAP to any core dependency tree; the license audit enforces it."],
  handoff="J9 works.",
),
"WP-26": dict(
  goal="Agents start from excellent templates, people see what Mostra can do, and the docs are built with Mostra itself.",
  reading=["../PRODUCT.md (journeys, quality and adoption)", "../DECISIONS.md D29, D63, D68", "../REPO_STANDARDS.md §8", "../../research/brief1-second.md (gallery ideas) via the INDEX"],
  detail=["Templates per family, one-off and long-lived, each with AGENTS.md and passing verify.", "Gallery with prompt, source and result, including the launch demos.", "Docs site built with Mostra, generated references, per-page Markdown, `llms.txt`, deployed to GitHub Pages under `mostra-dev`.", "SPA-mode completeness review (RS-02)."],
  out=["Evaluation suite (WP-27)"],
  risks=["Every example is a CI test: keep baselines committed and stable."],
  handoff="v1 is feature-complete for the closeout.",
),
"WP-27": dict(
  goal="An opt-in, paced evaluation suite that measures whether agents succeed with Mostra on the first try and keep succeeding across turns.",
  reading=["../DECISIONS.md D33, D34, D64, D72, D75", "../evaluations/eval-01/ (harness and report)", "../../research/brief6.md §1.1, §4.3"],
  detail=["Grow the EVAL-01 harness onto the real toolchain: scenarios over templates and journeys J1 to J12, first-pass verify, turns to pass, retention across turns.", "Pacing per D64, announcements per D34, records per STANDARDS.", "Re-run the base comparison on Mostra's own kit."],
  out=["Prose quality (never measured by evaluations)"],
  risks=["Model mix variety (D34): don't optimize for one model."],
  handoff="The phase closeout.",
),
}

ALWAYS = "Plus the files every WP reads ([README.md](README.md) §1)."


def main():
    req_rows, owners = load()
    text = (D / "WORK_PACKAGES.md").read_text()
    blocks = re.split(r"^### ", text, flags=re.M)[1:]
    out_dir = D / "work-packages"
    out_dir.mkdir(exist_ok=True)
    seen = []
    stale = []
    for b in blocks:
        head, body = b.split("\n", 1)
        m = re.match(r"(WP-\d\d)\. (.+)", head)
        wp, title = m.group(1), m.group(2).strip()
        seen.append(wp)
        det = DETAIL[wp]
        owns = re.search(r"^- \*\*Owns:\*\* (.+)\.$", body, re.M).group(1).split(", ")
        builds = re.search(r"^- \*\*Builds:\*\*(.*?)(?=^- \*\*Depends on)", body, re.M | re.S).group(1).strip()
        depends = re.search(r"^- \*\*Depends on:\*\* (.+)$", body, re.M).group(1)
        evidence = re.search(r"^- \*\*Evidence:\*\*(.*)$", body, re.M | re.S).group(1).strip()
        L = [f"# {wp}. {title}", "",
             f"<!-- Generated by tools/design/wp_specs.py. Edit WORK_PACKAGES.md or the generator, then regenerate. -->", "",
             "| | |", "|---|---|",
             f"| **Mode** | `PROGRAM MODE: work-package`, `WORK PACKAGE: {wp}` |",
             f"| **Depends on** | {depends} |",
             f"| **Branch** | `wp/{wp[3:]}-<short-name>` from the accepted predecessor |",
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
