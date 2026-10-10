# Mostra requirements

**Status:** Seed requirements for the SP-58-C03-A phase design. They are complete at the outcome level and trace to [DECISIONS.md](DECISIONS.md). C03-A refines wording, splits them where a work package needs it, adds requirements the detailed design discovers, and maps every one to a work package and evidence. It does not drop or weaken one without Mirza's approval.

**Strength.** Every row is a **requirement** ([STANDARDS.md](STANDARDS.md#rule-strengths)) unless it is marked **Invariant** or **Default**. Invariants are listed in [PRODUCT.md](PRODUCT.md#rule-strengths), and rows that restate one carry the label.

**Release.** `v1`, `v1.x` or `later` per D16.

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
| RT-03 | Artifact server code runs in one worker process per active artifact, started lazily and evicted when idle | v1 | D18 | I |
| RT-04 | A crash, hang or memory blow-up in one artifact leaves the gateway and other artifacts working; the failure is reported with an actionable message | v1 | D18 | I |
| RT-05 | Frozen client-only versions are served with no worker process | v1 | D18 | I |
| RT-06 | Mostra runs both as a host-spawned process over stdio and as a standalone daemon the CLI attaches to | v1 | D18, §4 | I, C |
| RT-07 | macOS and Linux are supported; Windows support is decided in C03-A design | v1 | PRODUCT | I |

## Versions and publishing (VR)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| VR-01 | **Invariant.** Publish creates an immutable, content-addressed version whose identity covers source, lockfile, Mostra/kit versions, mode and build config; the output digest is recorded separately | v1 | D09, D20 | M, I |
| VR-02 | Publish is atomic; a failed publish leaves no visible version | v1 | §3 | I |
| VR-03 | **Invariant.** Viewers only open published versions; no human path uses hot reload | v1 | D09 | B |
| VR-04 | A newer version shows a banner in open views; switching is the viewer's choice | v1 | D09 | B |
| VR-05 | Drafts carry over between versions by stable field ID; unmatched inputs are kept and marked orphaned, never silently dropped | v1 | D09 | I, B |
| VR-06 | Versions referenced by submissions, views or review sets are never garbage-collected | v1 | §3 | I |
| VR-07 | Export: client-only artifacts to static files or a single HTML file; server artifacts to a runnable bundle; any artifact to a snapshot archive with actions marked unavailable | v1 | D07, §3 | I, B |
| VR-08 | `mostra dev` offers optional hot reload for developers, clearly separate from viewing | v1 | D09 | I |

## Dependencies (DP)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| DP-01 | The curated warm set resolves instantly for every artifact with one React copy | v1 | D20 | I |
| DP-02 | Any npm package installs on demand into a shared content-addressed store with a per-artifact lockfile | v1 | D20 | I, X |
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
| IN-07 | Submission policy is configurable per host: `once` or `epochs` (linked immutable submissions) | v1 | D10 | M, C |
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
| AC-06 | Secrets used by actions are bound by name outside artifact source | v1 | §8 | I |
| AC-07 | Live data: loaders with polling, streams and file watching; push from CLI/SDK; one `useLive` hook; data never rides HMR channels | v1 | D08 | I, B |
| AC-08 | High-rate live data stays smooth (uPlot path; target rates set in C03-A design) | v1 | D26 | B |

## Review (RV)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| RV-01 | Comments can be pinned on any content (native DOM, canvas, kit charts, terminals, video and motion, served iframes, opaque iframes) | v1 | D23 | B |
| RV-02 | Anchors store all applicable layers (semantic ID, W3C selectors, coordinates with viewport/DPR, screenshot crop); the crop is always stored | v1 | D23 | M, B |
| RV-03 | Review sets support gallery, focus, synchronized compare (2 to 4) and choose-one; the choice and comments are part of the draft | v1 | D08, D23 | B |
| RV-04 | The review overlay lives in the trusted shell; artifact code cannot hide or forge it | v1 | D23 | B |
| RV-05 | `review export` produces Markdown and JSON with crop paths for agents | v1 | D29 | I |

## Shell and origins (SH)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| SH-01 | **Invariant.** The shell runs on its own origin; trusted controls never render in an origin agent code controls | v1 | D06, D21 | B |
| SH-02 | Artifacts can request trusted controls (with labels) but cannot render, click or spoof them; hosts choose whether artifact-rendered submit is allowed | v1 | D06 | B, C |
| SH-03 | **Default.** Each artifact has its own origin under `*.localhost`, with a port-per-artifact fallback that Safari uses | v1 | D21 | B |
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
| HY-05 | Quick public share via Tailscale Funnel or a Cloudflare quick tunnel behind an explicit flag and short-lived tokens | v1 | D12 | X |
| HY-06 | Security issues are handled under SECURITY.md with private reporting | v1 | STANDARDS | R |

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

## Kit (KT)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| KT-01 | **Default.** The kit in D26 ships, after C03-A re-verifies versions and licenses | v1 | D26 | M, B |
| KT-02 | **Invariant.** No non-OSI engine is bundled; the license audit runs in CI | v1 | D26 | M |
| KT-03 | Design-system packs ship for Base UI and Radix bases; one base per artifact; the default chosen by evaluation | v1 | D27 | B, E |
| KT-04 | One token system themes every kit library, supports dark mode and accepts host brand themes; names align with MCP Apps host variables | v1 | D26, §13 | B, R |
| KT-05 | Questionnaire and form components (choices with recommended option, ranking, scales, text, per-item comments, required items, sections, progress) persist through drafts | v1 | D08 | B, R |
| KT-06 | Mostra's own frame-based motion composition primitive with play, scrub and loop; deterministic for screenshots | v1 | D26 | M, B, R |
| KT-07 | Mostra's own MDX deck runtime with layouts, click steps, presenter view and print to PDF | v1 | D26 | B, R |
| KT-08 | Churned-API guidance and lint autofixes for the kit's libraries | v1 | §13 | M |
| KT-09 | "Beautiful by default": representative gallery artifacts pass Mirza's review | v1 | PRODUCT | R |

## Terminal and web demos (TM)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| TM-01 | A normalized terminal frame model and owned renderer that is pixel-consistent across modes on a fidelity fixture suite (box drawing, 256 and true colour, CJK, emoji ZWJ, combining marks) | v1 | D28 | M, B |
| TM-02 | Live mode: real program in a PTY rendered with xterm.js, with resize, input and recording to asciicast v3 | v1 | D28 | I, B |
| TM-03 | Recorded mode: asciicast v3 playback with scrubbing and markers | v1 | D28 | B |
| TM-04 | WASM mode: a Ratzilla template for ratatui | v1 | D28 | B |
| TM-05 | A Rust capture crate turns a ratatui TestBackend buffer and scripted keys into frames, with zero cell diff against WASM mode for the same app | v1 | D28 | M |
| TM-06 | `term dump` (text, cells, ANSI) and terminal lint for agents | v1 | D28, D29 | M |
| TM-07 | Terminal compare with synchronized playback and cell diff; comments on cell rectangles | v1 | D23, D28 | B |
| TM-08 | Web demos: the project's own dev server proxied on its own origin with HTTP and WebSocket passthrough, device frames, viewport switching and screenshots | v1 | D28 | I, B |

## Agent experience (AX)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| AX-01 | Every CLI command has `--json`, documented exit codes and no prompts in non-interactive or JSON mode; logs go to stderr | v1 | D29 | M |
| AX-02 | `verify` runs the full pipeline in ARCHITECTURE §15 and returns one JSON verdict | v1 | D29 | I, B |
| AX-03 | Diagnostics use one schema with stable codes (part of semver), hints, optional fixes and docs links | v1 | D29 | M |
| AX-04 | `verify` detects regressions against the last passing version | v1 | D29 | I |
| AX-05 | Screenshots default to DPR 1, carry token estimates and are returned only on failure or request | v1 | D29 | M |
| AX-06 | The Agent Skill, AGENTS.md, templates and gallery ship; their prose is accepted through Mirza's review | v1 | D29 | R |
| AX-07 | Docs site built with Mostra, with `llms.txt` and per-page Markdown | v1 | PRODUCT | B, R |
| AX-08 | An opt-in, budgeted agent-evaluation suite measures first-pass verify success, turns to pass and retention across turns (subject to D33 confirmation) | v1 | D33 | E |

## MCP (MC)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| MC-01 | A local MCP server: stateless, explicit handles, short tool names, about 8 to 15 tools covering create, write or patch, verify, publish, open, wait and results | v1 | D17, D32 | I, X |
| MC-02 | MCP Apps export: one artifact compiles to a single-file `ui://` resource with declared CSP, mapped theme variables and a bridge transport; the full-page URL is always offered | v1 | D07 | I, X |
| MC-03 | Features unavailable inside chat iframes degrade explicitly | v1 | §16 | B |

## Extensibility (EX)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| EX-01 | Extension contracts at 0.x for the points in ARCHITECTURE §17, each versioned in its own package | v1 | D30 | M |
| EX-02 | A plugin manifest under the `"mostra"` key with contracts, contributions, declared effects, SPDX license and bundled licenses, validated by `mostra plugin validate` | v1 | D30 | M |
| EX-03 | Copy-source packs in a superset of the shadcn registry format; any shadcn item installs unchanged | v1 | D30 | I |
| EX-04 | License classes shown at install; non-OSI classes need a one-time scriptable acknowledgment recorded in the lockfile; hosts can pre-accept | v1 | D31 | I |
| EX-05 | First-party plugins prove the contracts (xterm.js engine, MCP App exporter, Remotion adapter, GSAP adapter) | v1 | D30 | I, B |
| EX-06 | A metadata-only registry with namespace verification, provenance, compatibility badges and agent tools | v1.x | D30 | I, X |
| EX-07 | The marketplace web interface | later | D30 | R |

## RSC readiness (RS)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| RS-01 | The five seams in D19 exist and are covered by tests in v1 | v1 | D19 | M |
| RS-02 | SPA mode is complete and first-class on its own; no SPA component is built weaker in anticipation of RSC | v1 | D19 | R |
| RS-03 | The `rsc` render mode ships additively once its three triggers hold | v1.x | D19 | M, I, B |

## Remote readiness and remote mode (RM)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| RM-01 | v1 seams: portable artifact packages, ports for identity, storage and addressing, a worker-isolation interface, a stateless MCP design | v1 | D12 | M, R |
| RM-02 | Self-hostable remote mode per ARCHITECTURE §18 | v1.x | D12 | I, X |
| RM-03 | The managed cloud service | later | D12 | n/a |

## Engineering and release (EN)

| ID | Requirement | Release | Source | Route |
|---|---|---|---|---|
| EN-01 | **Invariant.** Apache-2.0 with NOTICE; DCO sign-off on contributions | v1 | D14 | M |
| EN-02 | The tooling baseline, test strategy and release process in STANDARDS.md | v1 | STANDARDS | M |
| EN-03 | Every example and template passes `verify` in CI, with committed visual and ARIA baselines | v1 | D29 | B |
| EN-04 | Public API reports gate pull requests; packages pass publint and type-resolution checks | v1 | STANDARDS | M |
| EN-05 | npm publishing only through trusted publishing with provenance, after Mirza authorizes publication | v1 | STANDARDS | X |
| EN-06 | Security policy, supply-chain controls (pinned actions, code scanning, dependency review, release-age cooldown) and an OpenSSF Scorecard | v1 | STANDARDS | M, X |
