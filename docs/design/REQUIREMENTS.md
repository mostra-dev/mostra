# Mostra requirements

**Status:** Seed requirements for the SP-58-C03-A phase design. They are complete at the outcome level and trace to [DECISIONS.md](DECISIONS.md). C03-A refines wording, splits them where a work package needs it, adds requirements the detailed design discovers, and maps every one to a work package and evidence. It does not drop or weaken one without Mirza's approval.

**Strength.** Every row is a **requirement** ([STANDARDS.md](STANDARDS.md#rule-strengths)) unless it is marked **Invariant** or **Default**. Invariants are listed in [PRODUCT.md](PRODUCT.md#rule-strengths), and rows that restate one carry the label.

**Release.** `v1`, `v1.1`, `v1.x` or `later` per D16. `v1.1` marks requirements built after the first release by the packages under "After the first release" in [WORK_PACKAGES.md](WORK_PACKAGES.md): Windows (D120) and the terminal modes (D122). Like `v1` rows, each has exactly one owning package, a concrete check and evidence, listed in their own section of [EVIDENCE_MATRIX.md](EVIDENCE_MATRIX.md). `v1.x` and `later` rows have no owner yet.

**Verification routes:**
- **M:** mechanism or unit tests.
- **I:** integration through real Mostra processes, gateway and storage.
- **B:** browser end-to-end through Playwright against the real gateway.
- **C:** host conformance kit.
- **X:** external system (a real tunnel, a real chat host, npm).
- **R:** Mirza's review.
- **E:** agent evaluation (D33).

## Authoring (AU)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| AU-01 | An artifact is ordinary React/TypeScript, with MDX supported; no DSL, schema or closed component list is required | v1 | D04 | M, B |
| AU-02 | A single TSX or MDX file is a complete artifact; a directory artifact supports pages, components, `"use server"` modules, data and assets | v1 | D04 | I, B |
| AU-03 | No per-artifact `package.json` or configuration is required to start | v1 | D18, D20 | I |
| AU-04 | Artifacts declare optional metadata (title, description, `family`, related artifacts) and a render `mode` defaulting to `spa` | v1 | D19, §2 | M |
| AU-05 | Every persisted input has a stable field ID; `verify` reports missing or duplicate IDs | v1 | D09 | M, B |
| AU-06 | `mostra new` scaffolds from templates for each family (questionnaire, proposal, prototype or review, dashboard, deck, demo, inbox or actions, custom) with AGENTS.md included | v1 | D29 | I, R |

## Runtime (RT)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| RT-01 | Mostra ships a private, hash-pinned Node LTS runtime bundle per platform; no global Node install is needed | v1 | D18 | I, X |
| RT-02 | One supervisor and gateway hosts many artifacts; it never loads artifact code in-process | v1 | D18 | I |
| RT-03 | Artifact server code runs in a worker process per active artifact version (normally one per artifact), started lazily, evicted after idle, restarted with backoff and parked after repeated crashes | v1 | D18, D62 | I |
| RT-04 | A crash, hang or memory blow-up in one artifact leaves the gateway and other artifacts working; the failure is reported with an actionable message | v1 | D18 | I |
| RT-05 | Frozen client-only versions are served with no worker process | v1 | D18 | I |
| RT-06 | One instance per home: a host-spawned process over stdio or a standalone daemon the CLI attaches to over the home socket; racing starters converge on one supervisor and stale sockets are recovered | v1 | D18, D45 | I, C |
| RT-07 | macOS and Linux are supported; on any other platform every entry point fails closed with a clear diagnostic (Windows is out of v1.0; RT-10 adds it in v1.1) | v1 | PRODUCT, D35, D120 | I |
| RT-10 | Windows support for the runtime, CLI, gateway and host protocol, with a Windows CI leg | v1.1 | D120 | M, I, X |

## Versions and publishing (VR)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| VR-01 | **Invariant.** Publish creates an immutable, content-addressed version whose identity covers source, lockfile, Mostra/kit versions, mode and build config; the output digest is recorded separately | v1 | D09, D20 | M, I |
| VR-02 | Publish is atomic; a failed publish leaves no visible version | v1 | §3 | I |
| VR-03 | **Invariant.** Viewers only open published versions; no human path uses hot reload | v1 | D09 | B |
| VR-04 | A newer version shows a banner in open views; switching is the viewer's choice | v1 | D09 | B |
| VR-05 | Drafts carry over between versions by stable field ID; unmatched inputs are kept as orphans, shown in a read-only "Not carried over" panel and delivered in a labelled `orphaned` section | v1 | D09, D42 | I, B |
| VR-06 | Versions referenced by submissions, views or review sets are never garbage-collected | v1 | §3 | I |
| VR-07 | Export: client-only artifacts to static files or a single HTML file; server artifacts to a runnable bundle; any artifact to a snapshot archive with actions marked unavailable | v1 | D07, §3 | I, B |
| VR-08 | `mostra dev` offers optional hot reload for developers, clearly separate from viewing | v1 | D09 | I |

## Dependencies (DP)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| DP-01 | The curated warm set resolves instantly for every artifact with one React copy | v1 | D20 | I |
| DP-02 | Any npm package installs on demand into a shared content-addressed store with a per-artifact lockfile; a host policy `dependencies: "explicit"` turns unknown imports into `MOSTRA_DEP_MISSING` with the exact `mostra add` command | v1 | D20, D43 | I, X |
| DP-03 | The lockfile hash is part of version identity; a frozen version rebuilds offline from the store | v1 | D20 | I |
| DP-04 | A missing package offline produces a structured error, never a hang | v1 | D20 | I |
| DP-05 | Package lifecycle scripts run in the artifact's execution context, not the supervisor's | v1 | D20 | I |
| DP-06 | No dependency on pnpm's PolyForm-licensed `pnpr/` or any other non-OSI component in the core | v1 | D14, D20 | M (license audit) |

## Interaction core (IN)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| IN-01 | Drafts persist server-side with monotonically increasing revisions, compare-and-set writes and idempotent mutation IDs | v1 | D22 | M, I |
| IN-02 | Autosave flushes on blur, visibility change and before submit; a closed tab loses no saved input | v1 | D22 | B |
| IN-03 | Tabs and devices viewing the same draft converge through the event stream; overlapping edits surface as conflicts | v1 | D22 | B |
| IN-04 | Offline edits are journaled in IndexedDB and replay in order; edits against incompatible versions are mapped or reported | v1 | D22 | B |
| IN-05 | **Invariant.** Submit creates an immutable submission from the canonical server draft, bound to the exact version and view, with a snapshot digest; duplicates return the original | v1 | D22 | M, I, B |
| IN-06 | **Invariant.** Drafts are never delivered as submissions | v1 | D10 | M, C |
| IN-07 | Submission policy is configurable per host: `once` (scope `per-artifact` or `per-viewer`), `epochs` (linked immutable submissions) or `none` | v1 | D10, D39, D63 | M, C |
| IN-08 | Every durable change emits an event with a stable ID and per-artifact sequence; hosts subscribe with filters and a durable cursor and resume without gaps | v1 | D10, D22 | M, C |
| IN-09 | Signals: Submit is standard; artifact code and actions can raise named signals; Mostra never decides on its own what wakes an agent | v1 | D10 | M, C |
| IN-10 | `wait` (CLI, MCP, SDK, protocol) blocks on a submission, signal or timeout; a timeout returns a resumable status and loses nothing | v1 | D11 | I, C |
| IN-11 | `results` returns the complete submission (snapshot, choices, comments with anchors and crops, version IDs, action-run references) as JSON and agent-readable Markdown | v1 | D11 | I |
| IN-12 | **Invariant.** A submission is durable before any delivery attempt; when a host's storage is unreachable, Mostra keeps it in an outbox and replays idempotently | v1 | D11, §7 | I, C |
| IN-13 | The viewer sees distinct states for submitted, delivered to host and pending delivery | v1 | §7 | B, R |

## Actions and live data (AC)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| AC-01 | **Invariant.** Agent-authored server functions run with full capability, with no capability or content restriction | v1 | D05, D24 | I |
| AC-02 | Each invocation is a durable action run with streamed progress, log, partial and final events; runs outlive the tab and can be re-attached | v1 | D24 | I, B |
| AC-03 | A client-generated idempotency key de-duplicates invocations; a double click runs once | v1 | D24 | I, B |
| AC-04 | Cancellation reaches the action through an AbortSignal | v1 | D24 | I |
| AC-05 | Actions can emit host events and signals | v1 | D10, D24 | C |
| AC-06 | Secrets used by actions are named, scoped to an artifact or the home, stored owner-only or supplied by the host's secrets port, and never appear in source, versions, exports, logs, events, diagnostics or screenshots | v1 | D44 | I |
| AC-07 | Live data: loaders with polling, streams and file watching; push from CLI/SDK; one `useLive` hook; data never rides HMR channels | v1 | D08 | I, B |
| AC-08 | High-rate live data stays smooth (uPlot path; target rates set in C03-A design) | v1 | D26 | B |

## Review (RV)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| RV-01 | Comments can be pinned on native DOM, canvas, kit charts, served iframes and opaque iframes (motion and video: RV-06; terminal cells: TM-07) | v1 | D23 | B |
| RV-02 | Anchors store all applicable layers (semantic ID, W3C selectors, coordinates with viewport/DPR, screenshot crop); the crop is always stored | v1 | D23 | M, B |
| RV-03 | Review sets support gallery, focus, synchronized compare (2 to 4) and choose-one; the choice and comments are part of the draft | v1 | D08, D23 | B |
| RV-04 | The review overlay lives in the trusted shell; artifact code cannot hide or forge it | v1 | D23 | B |
| RV-05 | `review export` produces Markdown and JSON with crop paths for agents | v1 | D29 | I |

## Shell and origins (SH)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| SH-01 | **Invariant.** The shell runs on its own origin; trusted controls never render in an origin agent code controls | v1 | D06, D21 | B |
| SH-02 | Artifacts can request trusted controls (with labels) but cannot render, click or spoof them; hosts choose whether the artifact submit channel is allowed; every submission records its channel and viewer | v1 | D06, D40 | B, C |
| SH-03 | **Default.** The shell and each artifact have their own origins on one loopback hostname with stably leased ports and origin-bound Strict sessions (cookie mode); cross-site deliveries use worker-mode frame sessions | v1 | D21, D38, D70 | B |
| SH-04 | Shell and artifact talk over a validated JSON-RPC `postMessage` bridge shaped like MCP Apps | v1 | D07, D21 | M, B |
| SH-05 | The shell's visual design is beautiful and unobtrusive and passes Mirza's review | v1 | PRODUCT | R |
| SH-06 | The shell and kit work on mobile browsers (responsive layout, touch review and submit) for remote viewing | v1 | D12, PRODUCT | B, R |

## Hygiene and remote viewing (HY)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| HY-01 | **Invariant.** Only capability-URL holders can use an artifact; the 13-point checklist in ARCHITECTURE §11 is implemented in full | v1 | D06 | M, I (negative tests: bad Host, bad Origin, missing token, CSRF) |
| HY-02 | Loopback is the default bind; wider binds need an explicit flag | v1 | D06 | I |
| HY-03 | Tokens are scoped (view, draft, submit, `action:<name>`, review), expire, rotate and revoke | v1 | D06 | M, I |
| HY-04 | Tailscale Serve exposure with identity-header mapping | v1 | D12 | X |
| HY-05 | Quick public share via Tailscale Funnel (cookie mode) or a Cloudflare quick tunnel (worker mode) behind an explicit flag and short-lived tokens, with long-poll where SSE doesn't pass | v1 | D12, D47, D70 | X |
| HY-06 | Security issues are handled under SECURITY.md with private reporting | v1 | STANDARDS | R |
| HY-08 | Viewer identity on remote servers: optional OAuth sign-in, display names for anonymous viewers recorded as unverified; capability URLs remain the authorization | v1 | D116, D121 | B |
| HY-09 | Hosted artifacts are served only from the user-content domain; the shell offers a report control in its own origin; a server policy can add an interstitial and an expiry to public links | v1 | D116 | B |

## Host integration (HO)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| HO-01 | Ports for identity, drafts, submissions, reviews, events, addressing, trusted controls and capture, with built-in standalone adapters | v1 | D25 | M, C |
| HO-02 | A versioned, language-neutral host protocol (JSON-RPC 2.0, stdio required) with capability negotiation and version refusal | v1 | D25, D32 | C |
| HO-03 | A Rust host crate (wire types, client, runtime-bundle management, port traits) | v1 | D17, D25 | C, X |
| HO-04 | A TypeScript SDK (`createMostra({ ports })`) | v1 | D25 | M, C |
| HO-05 | A host conformance kit with scenarios (durability across restart, exactly-once-in-effect delivery, outbox replay, identity, addressing, trusted-control round trip, hygiene rejections, version negotiation) and expected-failure baselines | v1 | D25 | C |
| HO-06 | **Invariant.** No host-specific code in the core; every Jcode need in JCODE_HOST.md is met through generic ports | v1 | D01 | C, R |
| HO-07 | **Invariant.** Interfaces and tool schemas change additively within a version; breaking changes need a new revision with a deprecation window | v1 | D32 | M |
| HO-08 | Hosts configure where artifact sources, versions and interaction data live; artifacts, versions and submissions stay readable after the directory the artifact was authored in is removed | v1 | D25, JCODE_HOST H-11 | I, C |
| HO-09 | Operator ports on the remote server (limits, metering, account resolution, abuse actions) with no-op defaults for self-hosters | v1 | D58, D116 | M, C |

## Kit (KT)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| KT-01 | **Default.** The kit in D26 ships, after C03-A re-verifies versions and licenses | v1 | D26 | M, B |
| KT-02 | **Invariant.** No non-OSI engine is bundled; the license audit runs in CI | v1 | D26 | M |
| KT-03 | Design-system packs ship for Base UI and Radix bases; one base per artifact; the default chosen by evaluation (EVAL-01) | v1 | D27, D34 | B, E |
| KT-04 | One token system themes every kit library, supports dark mode and accepts host brand themes; names align with MCP Apps host variables | v1 | D26, §13 | B, R |
| KT-05 | Questionnaire and form components (choices with recommended option, ranking, scales, text, per-item comments, required items, sections, progress) persist through drafts | v1 | D08 | B, R |
| KT-06 | Mostra's own frame-based motion composition primitive with play, scrub and loop; deterministic for screenshots | v1 | D26 | M, B, R |
| KT-07 | Mostra's own MDX deck runtime with layouts, click steps, presenter view and print to PDF | v1 | D26 | B, R |
| KT-08 | "Write this, not that" guidance and lint autofixes for every kit library and recently changed tool (Base UI `render`, Tailwind 4, Zod 4, `motion/react`, `@xyflow/react`, Mermaid 12, TanStack Table 9, the `cn` package), including the wrong-base diagnostic | v1 | §13, D48 | M |
| KT-09 | "Beautiful by default": representative gallery artifacts pass Mirza's review | v1 | PRODUCT | R |
| KT-11 | Kit components for presence, cursors, a respondent tracker and attribution, built on the CO hooks and restylable (KT-10) | v1 | D121, D68 | B, R |

## Terminal and web demos (TM)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| TM-01 | A normalized terminal frame model and owned renderer that is pixel-consistent across modes on a fidelity fixture suite (box drawing, 256 and true colour, CJK, emoji ZWJ, combining marks) | v1.1 | D28, D122 | M, B |
| TM-02 | Live mode: real program in a PTY rendered with xterm.js, with resize, input and recording to asciicast v3 | v1.1 | D28, D122 | I, B |
| TM-03 | Recorded mode: asciicast v3 playback with scrubbing and markers | v1.1 | D28, D122 | B |
| TM-04 | WASM mode: a Ratzilla template for ratatui | v1.1 | D28, D122 | B |
| TM-05 | A Rust capture crate turns a ratatui TestBackend buffer and scripted keys into frames, with zero cell diff against WASM mode for the same app | v1.1 | D28, D122 | M |
| TM-06 | `term dump` (text, cells, ANSI) and terminal lint for agents | v1.1 | D28, D29, D122 | M |
| TM-07 | Terminal compare with synchronized playback and cell diff; comments on cell rectangles | v1.1 | D23, D28, D122 | B |
| TM-08 | Web demos: the project's own dev server proxied on its own origin with HTTP and WebSocket passthrough, device frames, viewport switching and screenshots | v1 | D28 | I, B |

## Agent experience (AX)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| AX-01 | Every CLI command has `--json`, documented exit codes and no prompts in non-interactive or JSON mode; logs go to stderr | v1 | D29 | M |
| AX-02 | `verify` runs the full pipeline in ARCHITECTURE §12 and returns one JSON verdict | v1 | D29 | I, B |
| AX-03 | Diagnostics use one schema with stable codes (part of semver), hints, optional fixes and docs links | v1 | D29 | M |
| AX-04 | `verify` detects regressions against the last passing version | v1 | D29 | I |
| AX-05 | Screenshots default to DPR 1, carry token estimates and are returned only on failure or request | v1 | D29 | M |
| AX-06 | The Agent Skill (trigger D69) and AGENTS.md in the repository and in every scaffolded artifact ship; their prose is accepted through Mirza's review. Templates are AU-06, the gallery is AX-07 | v1 | D29, D69 | R |
| AX-07 | Docs site built with Mostra, with `llms.txt` and per-page Markdown | v1 | PRODUCT | B, R |
| AX-08 | An opt-in, budgeted agent-evaluation suite measures first-pass verify success, turns to pass and retention across turns (subject to D33 confirmation) | v1 | D33 | E |

## MCP (MC)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| MC-01 | A local MCP server: stateless, explicit handles, short tool names, about 8 to 15 tools covering create, write or patch, verify, publish, open, wait and results | v1 | D17, D32 | I, X |
| MC-02 | MCP Apps export: one artifact compiles to a single-file `ui://` resource with declared CSP, mapped theme variables and a bridge transport; the full-page URL is always offered | v1 | D07 | I, X |
| MC-03 | Features unavailable inside chat iframes degrade explicitly | v1 | §16 | B |
| MC-04 | A remote MCP server over Streamable HTTP with OAuth (dynamic and metadata-document client registration, refresh tokens), stateless with explicit handles; inline MCP Apps in cloud chat hosts persist drafts, submissions and actions through it | v1 | D61, D116 | I, X |

## Extensibility (EX)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| EX-01 | Extension contracts at 0.x for the points in ARCHITECTURE §17, each versioned in its own package | v1 | D30 | M |
| EX-02 | A plugin manifest under the `"mostra"` key with contracts, contributions, declared effects, SPDX license and bundled licenses, validated by `mostra plugin validate` | v1 | D30 | M |
| EX-03 | Copy-source packs in a superset of the shadcn registry format; any shadcn item installs unchanged | v1 | D30 | I |
| EX-04 | License classes shown at install; non-OSI classes need a one-time scriptable acknowledgment recorded in the lockfile; hosts can pre-accept | v1 | D31 | I |
| EX-05 | First-party plugins prove the contracts (MCP App exporter, Remotion adapter, GSAP adapter); the xterm.js engine plugin ships with the terminal packages | v1 | D30, D122 | I, B |
| EX-06 | A metadata-only registry with namespace verification, provenance, compatibility badges and agent tools | v1.x | D30 | I, X |
| EX-07 | The marketplace web interface | later | D30 | R |
| EX-08 | Embedding Mostra views in host applications: a chrome-less mode with host theming, identity and host-rendered trusted controls | later | D126 | B |

## RSC readiness (RS)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| RS-01 | The five seams in D19 exist and are covered by tests in v1 | v1 | D19 | M |
| RS-02 | SPA mode is complete and first-class on its own; no SPA component is built weaker in anticipation of RSC | v1 | D19 | R |
| RS-03 | The `rsc` render mode ships additively once its three triggers hold | v1.x | D19 | M, I, B |

## Remote readiness, remote server and relay (RM)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| RM-01 | v1 seams: portable artifact packages, ports for identity, storage and addressing, a worker-isolation interface, a stateless MCP design | v1 | D12 | M, R |
| RM-02 | Remote transport: the host protocol over an authenticated network transport, sign-in from the CLI, sharing a published version to a remote server, and reading waits, results and events back, with remote submissions delivered through the local outbox | v1 | D12, D116 | I, X |
| RM-03 | A self-hostable remote server hosts many homes behind one gateway with per-artifact origins on a separate user-content domain; the managed service's operating layer lives outside this repository and reaches the server only through operator ports | v1 | D12, D116, D118 | I, X |
| RM-04 | Relay: a remote server forwards hosted artifacts' action calls and live producers (and authoring operations, if WP-28 so decides under D117) to the owning instance over its outbound connection; secrets never leave the owner; offline behavior follows the artifact's policy | v1 | D117 | I |
| RM-05 | The remote design is recorded in ARCHITECTURE, INTERFACES, DATA_MODEL and FAILURE_MODEL, and WP-29 and WP-30 specifications are refined from it | v1 | D116, D123 | R |
| RM-06 | Sandboxed remote execution of actions and builds through `SandboxPort` | v1.x | D12, D116 | I, X |

## Engineering and release (EN)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| EN-01 | **Invariant.** Everything outside `ee/` that users install, embed or self-host is Apache-2.0 with NOTICE; DCO sign-off on contributions | v1 | D14, D118 | M |
| EN-02 | The tooling baseline, test strategy and release process in STANDARDS.md | v1 | STANDARDS | M |
| EN-03 | Every example and template passes `verify` in CI, with committed visual and ARIA baselines | v1 | D29 | B |
| EN-04 | Public API reports gate pull requests; packages pass publint and type-resolution checks | v1 | STANDARDS | M |
| EN-05 | Releases publish from the Changesets release pull request through a protected environment: npm trusted publishing (direct, provenance, tokens disallowed) and crates.io trusted publishing; accepting a WP authorizes its publication | v1 | STANDARDS, D36, D67 | X |
| EN-06 | Security policy, supply-chain controls (pinned actions, code scanning, dependency review, release-age cooldown) and an OpenSSF Scorecard | v1 | STANDARDS | M, X |
| EN-08 | Standalone CLI telemetry per D119: first-run notice, opt-out (setting, variable, `DO_NOT_TRACK`), the public event list, no content or identifiers, never in embedded use | v1 | D119 | M, I |
| EN-09 | `ee/` boundary per D118: the core never imports `ee/`; the license audit separates it; published core packages contain none of it | v1 | D118 | M |

## Collaboration (CO)

Team features (D121). API names and exact semantics are WP-31's to settle (D123).

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| CO-01 | Expected respondents can be named for an artifact or share; locally each gets a personal link | v1 | D121 | I, B |
| CO-02 | Wait conditions for "every expected respondent submitted" and "N submissions", with an event when the roster completes | v1 | D121 | I, C |
| CO-03 | Respondent status (not opened, drafting, submitted) through a client hook, the host protocol and the CLI | v1 | D121 | B |
| CO-04 | Presence through a client hook, with opt-in cursor and selection sharing as ephemeral, rate-limited traffic that is never stored | v1 | D121, D47 | B |
| CO-05 | Attribution of artifact-scoped fields (who and when) readable by the page | v1 | D121, D63 | B |
| CO-06 | `@mention` in review comments raises an event hosts can route | v1 | D121 | I |
| CO-07 | A visibility policy decides what viewers see of each other's status and presence; owners, agents and hosts always see respondent status | v1 | D121 | B |

## Added by the C03-A phase design

These requirements come from decisions made during the design (D38 to D71). They have the same strength and routes as the seed rows.

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| AU-07 | The manifest is a literal `defineArtifact` in the entry (frontmatter in MDX), read statically; artifact identity comes from the manifest `id` or a path binding at first publish, and a duplicate claim is a publish error | v1 | D51 | M, I |
| AU-08 | The client runtime offers `useField`, `useSubmit`, `useSubmitControl`, `useSignal`, `useAction`, `useLive`, `useChoice`, `useViewer`, `useArtifact`, a react-hook-form adapter and a Claude-compatible `window.storage` (INTERFACES §2.3) | v1 | D52, D53 | M, B |
| AU-09 | Multi-page artifacts use a `pages/` convention on React Router, with the history mode chosen per delivery target and the current page reported to the shell | v1 | D57 | B |
| RT-08 | Daemon, worker and port lifecycles follow D62: idle exit after 30 minutes unless needed, `mostra daemon install` for a login service, 1 GiB heap and 10 s watchdog defaults, and port leases reused across restarts | v1 | D62 | I |
| RT-09 | Every child process runs in its own process group, is recorded with PID and start time, and is reaped after a supervisor crash, including grandchildren such as demo servers and PTY programs | v1 | D45, FAILURE_MODEL §2 | I |
| VR-09 | Publish reuses the cached verify verdict for the exact source and environment digests or runs verify; errors refuse publish; `--force` publishes and records the failing codes | v1 | D41 | I |
| VR-10 | Published versions keep working on newer runtimes: the gateway serves every browser-protocol revision it has shipped, within the deprecation rule | v1 | D32, INTERFACES §4 | I, B |
| VR-11 | Version source snapshots live in the home, so versions, results and regression baselines don't depend on the authoring directory | v1 | HO-08, DATA_MODEL §1 | I |
| LL-01 | Artifact-scoped fields: viewers, agents (`mostra state`, `@mostra/server` `state`) and hosts write them with revisions, compare-and-set and mutation IDs; overlapping writes surface as conflicts on both sides; changes emit `state.changed` | v1 | D63 | M, I, B |
| LL-02 | Submission policy `none`: no Submit control; agents and hosts work through state, actions, signals and events | v1 | D63 | B, C |
| LL-03 | "Always follow this artifact": a per-viewer choice that loads new versions automatically unless unsaved edits or orphans would result | v1 | D63 | B |
| LL-04 | Live updates are ephemeral notifications over a persisted latest value and optional ring buffer; producers run while viewed or subscribed, or always with `always: true` | v1 | D56, D63 | I |
| LL-05 | Local capability URLs don't expire by default and stay revocable and rotatable; `mostra doctor` warns when long-lived artifacts exist without an always-on daemon | v1 | D63 | I |
| LL-06 | Templates, the conformance kit, the gallery and the agent evaluations include long-lived scenarios (J11, J12) alongside one-off ones | v1 | D63 | C, E, R |
| HY-07 | Worker-mode frame sessions: service-worker header authentication for cross-site frames, ticketed event streams and WebSockets, and a diagnostic when artifact code registers a conflicting root service worker | v1 | D70 | B |
| KT-10 | Design freedom: nothing enforces kit usage; every kit visual reads the tokens, accepts `className` and can be copied and edited; the defaults give a beautiful result without design skill | v1 | D68 | B, R |
| AX-09 | The CLI implements the D60 command set plus `mostra run` and `mostra state`, with the exit codes of INTERFACES §9 | v1 | D60 | I |
| AX-10 | Harness plugins for Claude Code, Codex, Gemini CLI, Cursor and Copilot are generated as real copies from one `skills/` source and plugin definition | v1 | D65 | I, X |
| EN-07 | Repository standards (REPO_STANDARDS.md): parallel, affected-only CI under 10 minutes for a typical pull request, `pnpm check` parity with CI, mechanical quality gates, lefthook, Conventional Commits with DCO, per-package AGENTS.md and agent playbooks | v1 | D50, D65 | M |
| RV-06 | Comments on timelines, motion and video anchor to time plus region, and on slides to slide and step | v1 | D23 | B |
