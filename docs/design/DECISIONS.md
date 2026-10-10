# Mostra decision record

**Authority:** Mirza's decisions in the design conversation of 2026-10-09 and 2026-10-10. This file is the single source of truth for what was decided and why. [PRODUCT.md](PRODUCT.md), [ARCHITECTURE.md](ARCHITECTURE.md) and [REQUIREMENTS.md](REQUIREMENTS.md) cite these IDs and work out their consequences. They don't restate the rationale.

**Status labels** follow [STANDARDS.md](STANDARDS.md#decision-labels). Every decision below is an **approved decision** unless its entry says otherwise. Mirza closed the round with this statement at **2026-10-10T07:05:13.203Z**: "Yes to everything. Nothing I want to add, change or reject."

## Source messages

| Ref | Time (UTC) | What Mirza said |
|---|---|---|
| M1 | 2026-10-09T15:47:18.227Z | Asked whether C03 can start while C02 is in progress. Wants the C03 tools to be "rather independent, third-party-like tools" that work elsewhere: "a modular system", "highly pluggable, very modular, flexible", "a separate repository, so that other people, other harnesses, other projects can use it too". C03 has two parts: designing the tool, then integrating it natively into Jcode after C02, "without having to make any changes to the tool itself". |
| M2 | 2026-10-09T16:23:33.180Z | Set the process (read, discuss, research, settle, wait for C02/WP-01, update program docs, then start C03-A, which "neither needs to read any jcode_program files, nor does it have to edit them"). Opened the product discussion: React-based, "no restrictions, strict shape, rigid boundaries", and the capability list in D08. On safety: "Safety of this is not this tool's concern. Don't implement/plan unnecessary guardrails that will simply reduce the quality of our tool". "Infinite capability." The goal is a tool good enough that "it goes viral". |
| M3 | 2026-10-10T05:48:06.596Z | Approved the first positions. Added: one submit usually carries everything, while the client application decides what each event triggers; the use cases in D11; remote hosting and remote agents, possibly a revenue stream; leaning against hot reload ("an incomplete artifact is not really useful"); plugins and a public marketplace. Answered: hygiene stances approved; public repository; remote viewing important ("Tailscale ... but also remote hosting in a simple quick easy way", else tunnels for v1); any npm package on demand left to the designer ("I guess yeah?"). |
| M4 | 2026-10-10T06:47:17.597Z | Answered the nine questions: positioning yes; viewing model yes; interaction model yes; runtime stack "sounds good" with RSC conditions (D19); remote scope "sounds good"; license delegated ("I trust your judgement"); interface priority "sounds excellent"; shadcn base settled in C03-A, "how about both"; name delegated. |
| M5 | 2026-10-10T07:05:13.203Z | "Yes to everything." Approved the RSC plan, multi-base shadcn, the name Mostra, the v1 scope, the C03-A home and standards, and the license acknowledgment flow. Asked for thorough documents in which nothing discussed is missed. |
| M6 | 2026-10-10T10:07:56.180Z | C03-A round 1. Confirmed agent evaluations with an ask-first rule, OAuth only, a mostly-GPT model mix and token-based cost reports. v1.0 explicitly excludes Windows. Approving a WP approves all of its publication. Postpone or cheapen the domain; created the GitHub org `mostra-dev`; npm org next. Delegated addressing (Q5) and secrets details. Approved Q6 to Q13, the round-1 defaults and the tooling stack, and asked that version-churn guidance cover every tool with a recent major. Added four working notes: ask him for anything, install any tool, use only the `fast-worker` sub-agent, and establish strong repository standards from the start. |
| M7 | 2026-10-10T10:59:01.070Z | C03-A round 2. Confirmed D34 as stated. Evaluations run in small batches, starting with a single call to find bottlenecks, then two or four at a time so a shared 5-hour usage limit isn't exhausted mid-batch; possibly two accounts; Claude runs to be discussed when ready; choose Codex or Jcode deliberately. Delegated Q2 to Q4 and approved Q5 to Q14, trusting C03-A's judgement throughout. Added a note: long-lived artifacts (a 24/7 personal dashboard, a company dashboard, an AI task manager) must be supported as fully as one-off artifacts, possibly with changes to submit and drafts. |
| M8 | 2026-10-10T12:41:03.402Z | C03-A rounds 3 and 4. Confirmed the long-lived additions (D63) and direct npm publishing "in a robust and enterprise-grade way"; approved round 3 ("I trust your judgement"). Shell prototype accepted as a direction; artifact design must be unlimited and up to the authoring agent, with a baseline that makes even a weak agent's output beautiful and lets a frontier model customize everything. Skill trigger: "The agent wants to visually communicate to/with the user." |
| M9 | 2026-10-10T14:55:06.757Z | Design approval. Q1: "Approved!" (the complete design, including D70 to D72 and the 27 work packages). Q2: WP-14 accepted as the planned C03-B threshold; "It's okay if this threshold moves to a later WP." Q3: approved a Claude check of EVAL-01 ("we can run it now"), asking first which harness it uses so he can sign in the right OAuth account. Q4: confirmed drafting the agent-facing prose in the WPs that build it. |
| M10 | 2026-10-10T15:11:53.172Z | Signed in Claude Code for EVAL-01b ("you can run the sonnet prompts"). GitHub: "i approve everything needed that we planned for git/github related stuff. you can create & push the repo, and the wp-01 agent can work on it in any way needed." |

## Program-level decisions

### D01. A standalone toolkit, integrated later
Mostra is an independent product in its own repository. Any agent harness or application can use it. Jcode is one host among many. Integrating Mostra into Jcode must not require changes to Mostra itself, so host-specific needs enter only through Mostra's public host ports and protocol. *Source:* M1, M5. *Consequence:* every Jcode need in [JCODE_HOST.md](JCODE_HOST.md) has to be expressible through generic ports.

### D02. Two units: C03-A and C03-B
In Mirza's Jcode program, SP-58-C03 splits into **C03-A**, the Mostra toolkit (this seed), and **C03-B**, native Jcode integration. C03-A runs now, in parallel with SP-58-C02. C03-B starts after C02 is complete and consumes a pinned Mostra release. *Source:* M1 proposal, M2 process, M5. *Rejected:* building C03 as Jcode-internal code (not reusable), and waiting for C02 before starting any C03 work (wastes the parallel window).

### D03. C03-A works from this seed only
C03-A doesn't read or edit Mirza's `jcode_program` corpus beyond this seed folder. The seed carries everything it needs: decisions, product, architecture direction, requirements, standards, the Jcode host brief and the research. Once the Mostra repository exists, its copy of these documents becomes the authority and the seed becomes a historical record. *Source:* M2, M5.

## Product decisions

### D04. Ordinary React
Agents write ordinary React and TypeScript, with MDX for document-heavy work. Mostra defines no custom language, no rigid schema the agent must fill in and no closed component list. Every bundled component can be replaced by arbitrary code. *Source:* M2. *Rejected:* declarative catalogs such as A2UI or json-render as the authoring model. They are acceptable only as optional guest formats inside an artifact.

### D05. Maximum capability
Mostra adds no content or capability guardrails. What an artifact does, including real side effects such as sending email, is the responsibility of the agent and the application that use Mostra, in the same way curl doesn't police URLs. Features are never weakened to prevent misuse. *Source:* M2. *Boundary:* D06 is not a guardrail. Abuse handling on a future public multi-tenant hosted service is an operator duty of that service (D12), not a toolkit restriction.

### D06. Hygiene that restricts strangers, not users
Two stances, approved together:
1. **Only the holder of an artifact's capability URL can use it.** Mostra binds to loopback by default and uses Jupyter-grade protection: an unguessable token exchanged for a scoped cookie, exact Host and Origin checks, CSRF protection and no permissive CORS. This keeps unrelated websites from driving a user's local artifact (for example, pressing its "Send" button). It doesn't limit the agent or the user.
2. **An optional trusted-controls slot.** A host may render its own controls (submit, approve, choose) in a trusted origin outside agent-authored content. Mostra offers the slot and enforces nothing. Hosts that need provenance, such as Jcode, use it. Others ignore it.

*Source:* M3 answer 1.

### D07. Positioning: an agent artifact runtime
Mostra is "the agent artifact runtime". It sits one layer below "generative UI": agents write normal software, and Mostra supplies durable human input, real actions, review, presentation, live data, exact terminal demos, verification for agents who can't see the browser, and host integration. One artifact has **three delivery targets**: a local full page, an inline MCP App in chat hosts, and a static or hosted page. Mostra compiles to MCP Apps and doesn't compete with it. *Source:* M4 answer 1. *Rejected positions:* an MCP-Apps-only framework (crowded and capped by chat iframes), a hosted Claude-Artifacts clone, a declarative UI framework, and another AI app builder.

### D08. What agents must be able to make
The capability catalog from M2, all in scope:
- Dashboards, many kinds of plots and other data presentation, interactive elements and demos.
- Motion graphics and animations embedded in pages, optionally interactive.
- Demos of any kind. TUI demos must show exactly what the program looks like in a terminal (for example, a real ratatui app rendered on the page). Web demos may use React, HTML, Angular or any framework, embedded as real working pages however the agent wishes.
- Interactive inputs stored server-side: questionnaires, forms and anything else. They integrate with everything else on the page. Example: the agent builds three demos, the human browses them, picks one, and comments on the one picked.
- Real data, local or online, including live API data that updates as it changes.
- Elements with real actions authored by the agent. Example: a personal assistant's morning inbox dashboard. Each email has an expandable pre-drafted reply that the human edits, then a "Send" button the agent built sends it.
- "Many more" that nobody has thought of yet. The extension system (D30) carries this.

*Source:* M2.

### D09. Users only see published versions
The human sees only published, immutable versions. There is no interactive hot reload in the human's view. The agent iterates privately, checking its work through `verify` and headless screenshots. When the agent publishes a new version while the human is viewing an older one, the page shows a "new version available" banner, and the human switches when they choose. Draft input carries over through stable field IDs. Hot module reload survives only as an optional developer tool. *Source:* M3 (hot reload "might cause bugs", "an incomplete artifact is not really useful"), M4 answer 2. *Consequences:* Vite acts as a builder in the human path, binding a submission to the version shown becomes trivial, and the research's "rendered revision during HMR" race disappears.

### D10. Interaction model
1. **Draft state accumulates.** Answers, interactive state, choices and comments save to the server as the human works, sync across tabs, and are delivered together. Comments are part of the draft, so they arrive alongside everything else.
2. **An event log records every durable change.** Hosts subscribe with filters and decide what an event triggers. Mostra never decides on its own that an event wakes an agent.
3. **Signals.** Submit is the standard signal. Artifact authors may define further non-terminal signals, such as a "Ping the agent" button. Hosts map signals however they choose.
4. **Submission policy is per host:** `once` (exactly one immutable submission, which Jcode uses) or `epochs` (repeatable, each epoch an immutable, linked submission).

*Source:* M3 ("most of the time, I would want to submit once ... the client ... would decide what triggers something from that event"), M4 answer 3.

### D11. Waiting on submission works everywhere
Every interface supports waiting for a submission: the CLI (`mostra wait <id> --until submitted --timeout <d>`), MCP (a long-polling wait tool that returns `still_waiting` on timeout), the SDK and the host protocol. Submissions are always persisted and readable later (`mostra results <id>`), so a timeout loses nothing and "I submitted, please check" always works. The use cases this serves:
- **Jcode:** the agent declares a wait on the artifact. Submit (for example "Submit & Send") ends the wait.
- **Codex, Claude Code and similar agents** use the CLI or MCP server.
- **ChatGPT and other chat products.** Inline MCP Apps work now. Agents without a filesystem need remote mode (D12).

*Source:* M3.

### D12. Remote scope and the release ladder
- **v1, local-first.** Local viewing plus a remote-viewing ladder: Tailscale Serve (tailnet-only, identity headers); a quick public share through Tailscale Funnel or a Cloudflare quick tunnel, behind an explicit flag and a capability token; and static export of client-only artifacts to any static host. v1 also builds the **remote-mode seams**: portable artifact packages, storage, identity and addressing ports, a worker-isolation interface and a stateless MCP design.
- **v1.x, remote mode.** A self-hostable remote server for agents without a filesystem. It provides a remote MCP server over Streamable HTTP with OAuth (CIMD, DCR and refresh tokens), revisioned file-push and patch authoring, server-side build and verify jobs, a `SandboxPort` and wildcard per-artifact origins.
- **Later: a managed cloud service.** A separate product and the revenue path. It may run on proprietary control-plane code (D14) and owns the operator duties of public hosting: abuse handling, a separate user-content domain and free-tier limits.

*Source:* M3 answer 3 and remote-agent comments, M4 answer 5.

### D13. Public repository
The Mostra repository is public. *Source:* M3 answer 2. *Note:* creating the public repository, organizations and domains are account actions that Mirza performs or approves (see [STANDARDS.md](STANDARDS.md#consequential-actions)).

### D14. License
Apache-2.0 for everything users install, embed or self-host: libraries, runtime, CLI, MCP server, self-host server, plugin contracts and first-party plugins. Contributions use the DCO (sign-off), not a CLA. Only a future managed cloud's multi-tenant control plane may be proprietary. The business is protected by trademark, hosting quality and network effects, not by license terms. *Source:* M4 answer 6 (delegated), research briefs 1, 6 and 7. *Rejected:* MIT (no explicit patent grant), FSL, BSL, ELv2 and AGPL for the core (they hurt adoption and embedding; tldraw and Remotion are the cautionary examples). *Overturn condition:* a well-funded clone of the hosted service could justify FSL-1.1-ALv2 for new cloud-only modules, never for the core.

### D15. Name: Mostra
**Mostra** is Italian for "exhibition" (the Venice Film Festival is the *Mostra*). In Italian and Portuguese it is also the imperative "show!". Packages are `@mostra/*`, and the CLI is `mostra` (`mostra new`, `mostra verify`, `mostra wait`, `mostra results`). *Source:* M4 answer 9 (delegated), M5. *Availability observed 2026-10-10:* no software project on GitHub with the name; npm org `@mostra` and GitHub orgs `mostra-dev` and `mostrajs` looked free; `mostra.dev` and `mostra.sh` looked unregistered. The bare npm name `mostra` is an empty 2022 placeholder, which can be disputed later; until then use `npm create mostra` and `@mostra/cli`. *Actions for Mirza:* register `mostra.dev`, npm org `@mostra` and GitHub org `mostra-dev`, and run a trademark search before public launch. *Fallback:* `mostrakit`. *Rejected:* `atk` (clashes with GNOME's Accessibility Toolkit and is unsearchable), Plinth (an existing AI engineering toolkit and Cardano's smart-contract language), Easel (EaselJS), Maquette (a virtual-DOM library), Voilà (Jupyter dashboards), Curio (Python async), and many common words already taken on npm.

### D16. Release scope
- **v1 (the complete local-first product):**
  - the runtime, versions and publishing, the tunnel ladder and static export;
  - drafts, submissions, the event log, signals, actions and live data;
  - the review layer;
  - the full kit, including the motion composition primitive and the deck runtime;
  - all three TUI modes and web demos;
  - the CLI, Skill, AGENTS.md, templates, `verify`, `wait` and `results`;
  - the local MCP server and MCP Apps export;
  - the TypeScript SDK, the host protocol, the Rust host crate and the host conformance kit;
  - plugin contracts at 0.x with first-party plugins.
- **v1.x:** remote mode (D12), the read-only plugin registry and its agent tools, RSC render mode once its triggers are met (D19), a Yjs collaboration plugin, and PDF and video exporters.
- **Later:** the managed cloud service and the marketplace web interface.

*Source:* M5. *Note:* v1 is large. C03-A splits it into work packages without shrinking it, under [STANDARDS.md](STANDARDS.md#completion).

### D17. Interface priority
In order: (1) the CLI, Skill and `verify`, built together with the host protocol and Rust host crate because Jcode needs them; (2) the local MCP server; (3) MCP Apps export. *Source:* M4 answer 7.

## Architecture decisions

### D18. Runtime stack
- Vite 8 builds a React 19 single-page application.
- Server functions run on Hono.
- A **private Node LTS runtime** ships with Mostra, so users never install Node globally. Pin 24 LTS now and move to 26 LTS after its LTS date.
- One supervisor and gateway process runs per Mostra instance, with one worker process per active artifact that has server code. Frozen client-only artifacts need no process.
- Hosts talk to Mostra through JSON-RPC over stdio. No host embeds a JavaScript engine.

*Source:* M4 answer 4, research briefs 2 and 2-second (both ranked this first). *Rejected:* Next.js, TanStack Start or React Router framework mode as the artifact format (heavy, lock-in; they may become adapters). RSC as the foundation (0.x, unstable, CVE history; see D19). Bun as the reference runtime (its 1.4 Rust rewrite is fresh, and static linking carries LGPL duties; Bun remains a CI target). Embedding V8, QuickJS or `deno_core` in hosts (cannot run Vite, churns, weaker crash containment). WebContainers and Nodebox as core (commercial terms).

### D19. React Server Components policy
- **SPA mode is permanent and first-class.** It stays the right default for most artifacts: it exports statically, works inside MCP Apps and needs no worker process when the artifact has no server code. It is never treated as temporary.
- **RSC arrives as an additive render mode** (v1.x minor, opt-in per artifact) when all three triggers hold:
  1. **Stability:** `@vitejs/plugin-rsc` reaches 1.0, a stable RSC mode ships in React Router or Waku 1.0 final, and six months pass with no new critical React Flight advisories.
  2. **Evidence:** Mostra's agent evaluations (D33) show that agents produce working data-heavy artifacts more often with RSC idioms, or that RSC-style attempts in SPA mode fail often enough to matter.
  3. **Bounded exposure:** Flight endpoints sit behind capability authentication. In local mode only capability holders reach them. In hosted mode, Flight parsing happens only after authentication.
- **Five seams ship in v1** so that RSC is additive, not a 2.x rewrite:
  1. artifact manifests declare `mode` (default `spa`);
  2. server functions follow React's `"use server"` contract (async functions, Flight-compatible serializable arguments and results), compiled to RPC stubs in SPA mode and to real Server Functions in RSC mode;
  3. server-side request context comes from AsyncLocalStorage;
  4. client runtime modules carry `"use client"`, avoid environment-assuming singletons and keep host-bridge access client-only;
  5. building and serving go through a `RenderMode` contract with SPA as the first implementation.
- **No weaker architecture before RSC.** Each seam is good engineering on its own merits. Nothing in SPA mode is built less robustly because RSC might replace it, and Mostra never builds its own server-component system to fill the gap.
- **Old artifacts never migrate.** Published versions are immutable. An artifact opts into RSC with a new version. In RSC mode, interactive components need `"use client"`.

*Source:* M4 answer 4 (Mirza's three conditions: when, what integration means, and "RSC later should not lead to a less robust architecture"), M5.

### D20. Dependencies
- A curated, pre-warmed set (React, the kit, Motion, xterm.js and similar) resolves instantly for every artifact, with a single React copy.
- **Any npm package works on demand.** It installs into a shared content-addressed store with a per-artifact lockfile.
- The lockfile hash is part of the version identity.
- Offline use works for anything in the store. A missing package produces a clear error, never a hang.
- Package lifecycle scripts run in the artifact's execution context, not the supervisor's.
- Mostra uses only pnpm's MIT-licensed parts, never the PolyForm Shield `pnpr/` directory.

*Source:* M3 answer 4 (delegated), M5, research brief 2-second. *Rejected:* import maps to public CDNs as the default (online-only, leaks usage, a second resolution graph). They remain an optional lightweight mode.

### D21. Isolation and addressing
- Each artifact gets its own browser origin (`<artifact>.localhost:<port>`). Paths would make artifacts share an origin, so path routing is the weakest fallback.
- Safari doesn't resolve `*.localhost`, so a port-per-artifact fallback exists.
- The trusted shell (review overlay, trusted controls, version banner) runs on a separate origin.
- All of this sits behind the addressing port, so tunnel and hosted modes can map origins differently without changing artifacts.

*Source:* research consensus (briefs 2, 2-second, 5, 5-second), M5. *Amended by D38:* v1 addresses artifact origins by port on the shell's host, not by `*.localhost` subdomain.

### D22. State model
- **Drafts** are server-authoritative documents with monotonically increasing revisions and compare-and-set writes. Mutations carry stable IDs. Non-overlapping edits rebase automatically, and true overlaps surface as conflicts.
- **The event log** is append-only, with stable event IDs and a replay cursor.
- **Submissions** are immutable. The server creates them from its canonical persisted draft, never from page-supplied JSON. Each submission names the exact artifact version and view the human saw.
- **Transport:** commands go up over HTTP. One resumable event stream (SSE semantics) comes down. WebSocket is used only for terminals and high-rate bidirectional work.
- **Offline:** an IndexedDB mutation journal replays on reconnect.
- **CRDTs:** Yjs is an optional plugin for real co-editing, never the base.

*Source:* research consensus (briefs 5 and 5-second), M5.

### D23. Review layer
- Review lives in the trusted shell's overlay, never inside agent code. It therefore works over any content: native React, canvas, terminals, and same- or cross-origin iframes.
- **Anchors** resolve in order: semantic ID (`data-review-id`), W3C Web Annotation selectors, frame-relative coordinates, then a screenshot crop of the region. The screenshot crop is always stored.
- **Review sets** (gallery, side-by-side compare, choose one) are first-class objects. A choice is part of the draft and is delivered with the submission.

*Source:* M2 example, research consensus, M5.

### D24. Actions
- Agent-authored server functions run with full capability.
- Every invocation is a durable `ActionRun` that records progress, output, cancellation, its final state and an idempotency key, so a double click never sends two emails.
- An action may emit a host event or a signal.
- Retries happen only in the author's code, never implicitly.

*Source:* M2 email example, research briefs 5 and 5-second, M5.

### D25. Host ports and protocol
- Hosts integrate through ports: identity, drafts, submissions, reviews, events, addressing, trusted controls and capture, plus a sandbox port in v1.x.
- The standalone CLI is just a built-in adapter set (local storage, local identity, `*.localhost` addressing, Mostra's own shell).
- The host protocol is versioned and language-neutral, with capability negotiation.
- A Rust host crate and a host conformance kit ship in v1.

*Source:* D01, research consensus, M5. *Amended by D58:* the drafts, submissions and reviews ports deliver and mirror; Mostra's store stays canonical.

### D26. Kit defaults and the license boundary
The default kit follows research brief 3:
- UI and styling: shadcn/ui on Tailwind CSS 4.
- Charts: Recharts 3 through shadcn charts, uPlot for high-rate live data, ECharts 6 for breadth.
- Tables: TanStack Table.
- Forms: react-hook-form with Zod 4.
- Diagrams: Mermaid, xyflow and Excalidraw.
- Maps: MapLibre with deck.gl.
- 3D: react-three-fiber.
- Code: Shiki for display, CodeMirror 6 for editing.
- Math: KaTeX.
- Motion: Motion, plus Mostra's own frame-based composition primitive.
- Slides: Mostra's own MDX deck runtime.

**Non-OSI engines are never bundled** (GSAP, Remotion, tldraw, AG Grid Enterprise, Theatre.js Studio). They exist only as user-installed plugins with license disclosure (D31). *Strength:* the kit list is a **default**, which C03-A may refine with evidence. The license boundary is an **invariant**. *Source:* M5.

### D27. Several shadcn bases
The design system ships as shadcn-registry items with base variants: Base UI and Radix in v1, and React Aria later as a plugin. Each artifact uses one base. Mostra's higher-level components use only public component APIs plus a small `Slot` adapter for the `asChild` versus `render` difference, so supporting several bases costs CI time, not duplicate code. `verify` flags idioms that belong to a different base. The **default base** is chosen by a C03-A evaluation of first-pass success. *Source:* M4 answer 8 ("how about both"), M5.

### D28. TUI and web demos
- **One terminal frame model** (cells, styles, cursor, size) with Mostra's own renderer for static and recorded content.
- **Live mode:** xterm.js over a PTY.
- **Recorded mode:** asciicast v3 recordings.
- **WASM mode:** Ratzilla for ratatui.
- **Capture:** a ratatui TestBackend capture crate.
- **Agent checks:** text, cell and screenshot dumps let agents verify terminal output without vision.
- **Web demos:** run the demo's own dev server and proxy it into an iframe on its own origin, with WebSocket passthrough, viewport switching and device frames. In-browser bundling is only an optional snippet mode.

*Source:* M2 ("render TUI in React ... precisely"), research brief 4, M5.

### D29. Agent experience
- **`verify` is the decisive feature.** It builds and type-checks the artifact, renders it headlessly with Playwright, and captures console, network and accessibility findings, an ARIA snapshot and multi-viewport screenshots. It also runs a synthetic smoke test with actions in dry-run mode, and regression checks against the last passing version.
- **Output:** one JSON verdict with stable diagnostic codes.
- **Documentation for agents:** an Agent Skill, AGENTS.md in the repository and in every scaffolded artifact, templates, and a gallery that shows source next to result.
- **CLI:** every command has a `--json` mode and documented exit codes.

*Source:* research brief 6 and consensus, M5.

### D30. Extensibility
- Toolkit, components and other features are all extensible.
- **Runtime plugins** are npm packages that declare a `"mostra"` manifest key and implement small typed contracts. Each extension point's contract is versioned separately from the core.
- **Source packs** (components, templates, themes, starters) are copy-source items in a superset of the shadcn registry format, so any shadcn item installs unchanged.
- **First-party plugins** prove each contract.
- **Registry:** a metadata-only registry with agent search tools comes in v1.x. The public marketplace web interface comes later.
- **Trust:** shown through provenance, verified namespaces, compatibility badges and license metadata. Never through capability gates.

*Source:* M3 ("a public marketplace that the users/agents can add to"), research brief 8, M5.

### D31. License acknowledgment
Installing a plugin that pulls in a non-OSI engine requires a one-time, scriptable acknowledgment (`--accept-license <id>`), recorded in the artifact's lockfile. A host may pre-accept by policy. This is disclosure that protects users from accidental license liability. It is not a capability limit. *Source:* M5.

### D32. Interfaces evolve additively
Tool schemas (CLI JSON output, MCP tools) and protocol messages change additively within a version: new optional fields and new tools, never changed meanings. ChatGPT freezes tool snapshots after approval, and hosts pin versions. Breaking changes need a new protocol revision with a deprecation window. *Source:* research briefs 6 and 7, M5.

### D33. Agent evaluations for Mostra (confirmed by D34)
Mostra may keep an opt-in, budgeted agent-evaluation suite. It measures toolkit ergonomics (first-pass `verify` success, turns to pass, retention across turns), not prose quality. D27 and D19 depend on it. Skill and documentation prose is still accepted through Mirza's review, never through phrase tests. *Label:* approved by implication, because Mirza approved the decisions that rely on it. C03-A confirms it explicitly in its first decision round, because Mirza's Jcode program excludes behavioral benchmarks from that program, and Mostra is a separate project.

## C03-A phase-design decisions

Decisions taken with Mirza during the SP-58-C03-A phase design. Each one is an **approved decision**. Where Mirza delegated a choice, the entry says so and names the evidence.

### D34. Agent evaluations: confirmed, ask first, OAuth, model mix
D33 is confirmed. Rules for every run that makes real model requests:
1. **Ask first.** Before every batch run, the agent tells Mirza what question the batch answers, which models it uses in what ratio, and the estimated cost **in tokens** (never dollars). A batch that uses any Anthropic model waits for his explicit approval. A batch that uses only GPT models doesn't need approval; the agent still announces it before starting. *(Confirmed in M7.)* How batches are paced is in D64.
2. **OAuth, never API keys.** Runs authenticate through the vendors' OAuth logins (for example the Codex and Claude Code CLIs signed in to Mirza's accounts).
3. **Model mix.** Mostly **GPT-6.1-Sol**, with some **Claude Sonnet 5.5** and **Claude Opus 5.5**, roughly 70/15/15. The ratio is a guide: the agent picks models and proportions per question, keeping variety so Mostra isn't tuned to one model.
4. **No fixed caps.** Report token usage per run with provider, model and date (STANDARDS, Verification).

*Source:* M6 Q1. *Supersedes* the "budget Mirza approves" wording in STANDARDS with the ask-first rule.

### D35. Windows is out of v1.0
v1.0 explicitly does not support Windows. Windows stays on the roadmap for a later release. The v1 design need not constrain itself for Windows. On an unsupported platform every Mostra entry point fails closed with a clear diagnostic. *Source:* M6 Q2. *Resolves* RT-07.

### D36. Approving a work package approves its publication
When Mirza accepts a work package, that acceptance authorizes every publication step for it: pushing to the public repository, publishing to npm and crates.io, creating releases and deploying the docs site. Agents ask only when something is uncertain or a real dilemma arises. *Source:* M6 Q3. *Changes* STANDARDS, Consequential actions.

### D37. No domain yet; GitHub org created
Mostra postpones buying a domain. The docs site is hosted for free on GitHub Pages under the `mostra-dev` GitHub organization, which Mirza created. Docs links in diagnostics and tools use one configurable base URL, so a later domain only changes that base (GitHub Pages redirects to a custom domain once one is configured). If a domain is bought later, `mostrakit.dev` and `mostradev.com` fit the budget. Mirza is creating the npm organization `@mostra`. *Source:* M6 Q4. *Amends* D15's action list.

### D38. Addressing: port-per-artifact origins with cookie sessions (delegated)
In v1, the shell and every artifact share one host and differ by port: the shell on the instance's gateway port, each artifact on its own leased port. The two are the same **site** and different **origins**, so D06's mechanism holds as written: the capability token is exchanged for an `HttpOnly; SameSite=Strict` session cookie. Ports are leased stably per instance and artifact, so capability URLs and per-origin browser storage survive restarts. The gateway strips Mostra session cookies before proxying to workers, foreign apps or terminals, and binds each session to the one origin it was issued for. Tunnel modes map onto ports of the tunnel hostname the same way. Hosted remote mode (v1.x) is cross-site by nature and gets its own frame-credential design behind the addressing port.

*Evidence:* [VERIFIED_FACTS.md](VERIFIED_FACTS.md#browser-addressing-and-cookies-prototype-evidence). Artifact iframes on `*.localhost` subdomains are third-party contexts: Chromium and Firefox drop Strict and Lax cookies there, and Safari 26.2 drops every cookie. Same-host port origins carry Strict cookies in all four engines tested. Tailscale gives one hostname per device, and Funnel allows ports 443, 8443 and 10000. *Rejected:* capability-bearing subdomains (unusual, and tunnels still need ports) and path-prefix capabilities (absolute paths in agent code break). *Source:* M6 Q5 (delegated). *Amends* D21.

### D39. Draft scope and the `once` scope
A draft belongs to one artifact and one viewer identity, so a refresh, a second tab or a second device of the same identity continues it. The `once` policy takes a scope: `per-artifact` (default: exactly one submission per artifact, which Jcode uses) or `per-viewer` (one submission per viewer identity, for surveys). `epochs` is unchanged. *Source:* M6 Q6. *Refines* D10 additively.

### D40. Submit channels
In the standalone host, both the shell's trusted Submit and the artifact's own `submit()` create submissions. Every submission records its channel (`shell` or `artifact`) and the viewer identity. A host can restrict submission to the shell channel; Jcode does. *Source:* M6 Q7.

### D41. Publish is gated by verify
Publish reuses the verify verdict cached for the exact source and environment digest, and runs `verify` when none exists. Error-severity diagnostics block publish. Warnings don't. `--force` publishes anyway and records the failing codes in the version manifest, where hosts can read them. *Source:* M6 Q8.

### D42. Fields that don't carry over
When a newer version can't map some draft fields, the banner says how many answers won't carry over. After switching, a "Not carried over" panel shows those values read-only and copyable. The submission carries them in a labelled `orphaned` section. Nothing is dropped. *Source:* M6 Q9.

### D43. Dependency policy
Unknown imports auto-install into the shared store by default, and publish freezes the lockfile. A host policy `dependencies: "auto" | "explicit"` switches to explicit mode, where the agent gets the structured diagnostic `MOSTRA_DEP_MISSING` with the exact `mostra add` command. *Source:* M6 Q10.

### D44. Secrets (details delegated)
Secrets are named values held outside artifact source in the Mostra home, in an owner-only (0600) store. `mostra secret set NAME` reads the value from stdin. A secret is scoped to one artifact or shared within the home, and server code reads it by name. Secrets never enter source, versions, exports, logs, diagnostics, events or screenshots. A host may supply secrets through a port instead (Jcode can use its own credential store). A keychain-backed store can come later as a plugin. *Source:* M6 Q11 (implementation details delegated).

### D45. Instance model: one instance per Mostra home
A Mostra home is a directory holding one instance's registry, versions, interaction data and secrets. At most one supervisor runs per home, enforced by a lock. The CLI starts the home's daemon on demand, or attaches to it through an owner-only Unix socket in the home. A host either spawns its own instance over stdio with its own home or attaches to a running daemon. `MOSTRA_HOME` selects the home, so a CLI running inside a host's environment reaches that host's instance. Several homes can run side by side for unrelated hosts. *Source:* M6 Q12. *Resolves* the instance-model question in ARCHITECTURE §4.

### D46. AI port is out of v1
The optional AI port is not part of v1. The capability name is reserved in protocol negotiation so it can be added later without a breaking change. *Source:* M6 Q13.

### D47. Round-1 defaults
Adopted without objection:
- **Retention.** Every published version is kept. `mostra gc` removes only unreferenced versions and only on request. Build caches are LRU-capped, 5 GB by default.
- **Events.** Durable events are kept. Compaction is opt-in, writing a snapshot plus a cursor; resuming from a compacted cursor returns the snapshot. Ephemeral traffic is never stored.
- **Action runs** live with their artifact. Per-run logs cap at 1 MB with a truncation marker.
- **Viewer-visible states.** Drafts: Saving, Saved. Submissions: Submitted (durable in Mostra), Delivered (host acknowledged), Pending delivery (retrying), and Undeliverable when the host reports it.
- **Comments.** Threads with replies, resolve and reopen. Each message records its author. Resolution state travels with the submission.
- **Sharing.** `mostra share --tailnet` and `mostra share --public --ttl <d>` drive installed `tailscale` or `cloudflared` and explain how to install them when missing. The event stream falls back to long-polling on the same cursor wherever SSE is unavailable, such as behind a Cloudflare quick tunnel.
- **Later plugins.** The AG-UI adapter, the A2UI guest renderer and the import-map/CDN dependency mode are v1.x.

*Source:* M6.

### D48. Tooling deviations and version-churn guidance
The STANDARDS tooling baseline moves to pnpm 12 (npm's `latest` since the research), Vitest 5, the v2 MCP TypeScript SDK packages, Node 24 now and Node 26 after its LTS date of 2026-10-28, and TanStack Table 9. Whenever a tool Mostra ships or recommends has a recent major release or rename that models are likely to get wrong, Mostra ships "write this, not that" guidance and, where possible, a lint rule with an autofix. This applies beyond the kit libraries. *Evidence:* [VERIFIED_FACTS.md](VERIFIED_FACTS.md). *Source:* M6.

### D49. Working agreements for Mostra agents
1. Agents may ask Mirza for anything at any time, including new external research reports and subscriptions.
2. Agents may install any tool without asking. Large installs may use the external disk named `Active` when the internal disk is tight.
3. The only sub-agent Mostra agents use is `fast-worker`, for summarizing bulk reading. Jcode's other sub-agents aren't ready yet.
4. Agents ask Mirza for a context compaction at natural points, such as after a self-contained stretch of work. Compaction summarizes named slices of earlier work, not the whole session, so the request names the slices that can be summarized and the material that must stay.

*Source:* M6 notes 1 to 3. *Changes* STANDARDS, Working with Mirza.

### D50. Repository standards from the first commit of code
The repository starts with strong engineering standards, designed in this phase and set up by the first work package:
- a modular CI that runs independent checks in parallel and caches aggressively;
- a defined quality toolchain: formatting, linting, type checking, language servers, API reports, license and dependency audits, and more;
- commit, pre-commit and pull-request standards;
- structured documentation for agents and humans, so every worker reads what it needs, erring towards reading more;
- a seamless publication pipeline.

The aim is that agents don't repeat work, naturally produce modular, modern, high-quality code, and never wait on checks that don't depend on each other. *Source:* M6 note 4. *Detailed in* the dossier's repository-standards document.

### D51. Manifest in the entry file (delegated)
Artifact metadata is a literal object in the entry file: `export const artifact = defineArtifact({...})` in `index.tsx`, or frontmatter in `index.mdx`. Mostra extracts it statically (the supervisor never runs artifact code), and a non-literal value is a compile diagnostic. A single file with no manifest is a complete artifact with defaults. The fields are `id`, `title`, `description`, `family`, `links`, `mode` (default `spa`), the requested `submission` policy (the host decides), `limits` and `verify`. `mostra new` writes a generated `id`. An artifact without one is bound to its canonical source path at first publish, and two paths claiming one `id` is a publish error. *Rejected:* `mostra.json` (a second file for any metadata) and `artifact.config.ts` (two forms, and it must be executed or restricted to literals anyway). *Source:* M7 Q2 (delegated). *Resolves* ARCHITECTURE §2 manifest form.

### D52. Field hooks and field identity (delegated)
The client runtime's persistence primitive is `useField(id, initial, options)`, which behaves like `useState` with a stable ID. Alongside it come `useSubmit`, `useSignal` and `useSubmitControl`. IDs are explicit strings, and dotted IDs nest in results. The options are `label`, `required`, `validate`, `sensitive` (redacted from logs and events, kept in the submission) and `scope` (D63). `verify` reports duplicate IDs and IDs that change between renders as errors, and unbound form controls as hints. `@mostra/react/form` adapts react-hook-form onto the same fields. *Rejected:* one schema-typed draft document (a store each artifact must design, path-level conflicts, schema migrations between versions). *Source:* M7 Q3, Q4 (delegated). *Resolves* ARCHITECTURE §2 field identity and §7 client runtime API.

### D53. `window.storage` compatibility
The client runtime installs a `window.storage` compatible with Claude artifacts. Personal keys are viewer-scoped fields under `storage.<key>`. `shared: true` keys are artifact-scoped fields (D63). `verify` hints towards `useField` for form inputs. *Source:* M7 Q5.

### D54. Server functions and action runs
Calling a `"use server"` function directly is a plain RPC with no durable record. `useAction(fn, { key })` turns each invocation into a durable `ActionRun` (D24). By default there is one in-flight run per hook instance, so a double click joins the running invocation. An explicit `key` makes the invocation at-most-once across reloads, tabs and devices. Server context comes from `@mostra/server` imports (`progress`, `secret`, `signal`, `dryRun`, `viewer`, `abortSignal`) backed by AsyncLocalStorage. Arguments and results use exactly React's documented Server Function type set plus `AsyncIterable` results, through one Mostra serializer with conformance tests against React's behavior. There is no `*.server.ts` convention. *Source:* M7 Q6. *Resolves* ARCHITECTURE §5 serialization and file convention.

### D55. Dry-run opt-in for `verify`
An action opts into `verify`'s smoke test by checking `dryRun()`, and the compiler records which `"use server"` exports reference it. `verify` never invokes an action that hasn't opted in. The click gets a synthetic "skipped in verify" result, and the verdict lists the skipped actions. *Source:* M7 Q7. *Resolves* ARCHITECTURE §8 dry-run semantics.

### D56. Live sources
Live data is its own concept. `live.ts` exports `defineLive({ load, refresh | watch | stream })` producers, which the artifact's worker runs. `mostra push`, the SDK and the host protocol push values into the same sources. The page reads them with `useLive(key)`, which returns `{ data, isLoading, error, refresh }`, and can request an append mode with a ring buffer for high-rate charts. Values carry server-assigned revisions, the latest value persists (D63), and a view records the revisions it saw. Types reach client code through a generated declaration file, never by importing server code. *Rejected:* client polling of server functions (per-tab load, no shared latest value, and React advises against server functions for data fetching). *Source:* M7 Q8.

### D57. Multi-page routing
Multi-page artifacts use a `pages/` convention on React Router. Mostra chooses the history mode per delivery target: browser history locally, hash routing for static export, memory routing inside MCP Apps. The runtime reports the current page to the shell so comments record it. *Source:* M7 Q9. *Resolves* ARCHITECTURE §2 routing.

### D58. Mostra-owned ledger; ports deliver and mirror
Mostra's own transactional store is always the canonical record of drafts, artifact state, submissions, reviews, action runs and events. It lives inside the home the host configures. Hosts integrate through small, idempotent, optional ports, each with a standalone default:
- `identity`;
- `submissions`: deliver, then accepted or rejected with a reason, with outbox and idempotent replay on failure;
- `drafts` and `reviews`: optional opaque mirrors;
- `events`: the host pulls with a filter and a durable cursor;
- `addressing`, `trustedControls`, `capture`, `secrets` and `pty`.

"Accepted by Mostra" and "accepted by the host" remain separate, reported facts. *Rejected:* host-supplied stores. Every host would have to reimplement compare-and-set, idempotency and unique submissions, and would still need a local store for the outbox. *Source:* M7 Q10. *Amends* D25 and the ARCHITECTURE §12 port table.

### D59. One host protocol for every client
The CLI, the local MCP server, the TypeScript SDK and the Rust crate all speak one versioned JSON-RPC 2.0 protocol to the supervisor. They use stdio when a host spawns Mostra and the home's Unix socket when attaching to its daemon. Port callbacks travel on the same connection and reach only the connection that registered them. Zod 4 is the schema source. Generated JSON Schema 2020-12 is published, and draft-07 feeds typify for the Rust wire types, which are committed with a snapshot test. The Rust client is hand-written. Revisions are dated, negotiated in `mostra/initialize` and change additively, with at least 12 months of deprecation. *Source:* M7 Q11. *Resolves* ARCHITECTURE §12 transports, schema source and versioning.

### D60. CLI command set
`new`, `dev`, `verify`, `publish`, `open`, `share`, `wait`, `results`, `review export`, `push`, `state` (D63), `term dump`, `add`, `export`, `secret`, `list`, `status`, `daemon`, `host`, `mcp`, `plugin`, `docs`, `doctor` and `gc`, as specified in [rounds/ROUND-2.md](rounds/ROUND-2.md#31-cli-command-set-cl1). Artifacts are addressed by source path or ID. Help text is drafted with Mirza. *Source:* M7 Q12.

### D61. MCP tools and MCP Apps persistence
The local MCP server has about twelve tools under an `artifact_` prefix (create, write, patch, verify, publish, open as the render tool, wait, results, list), plus `live_push`, `docs_search` and app-only tools for exported MCP Apps. In v1, inline MCP Apps persist drafts, submissions, actions and events through the local MCP server. Cloud chat hosts need remote mode (v1.x). Until then the exported page states that answers can't be saved there and offers the full-page URL. Tool descriptions are drafted with Mirza. *Source:* M7 Q13.

### D62. Process details
- **Home layout:** `registry/`, `versions/`, `store/` (SQLite), `deps/`, `secrets/` (0600), `cache/`. The control socket lives in a short per-user runtime directory.
- **Daemon:** keeps running while it has open views, active shares, pending deliveries, running producers or attached clients, and otherwise exits after 30 idle minutes. `mostra daemon install` registers a launchd or systemd user service for always-on use (D63). A host-spawned instance lives as long as its stdio connection.
- **Workers:** started on demand, evicted after 10 idle minutes, restarted after crashes with exponential backoff and a reported cause.
- **Default limits** (stability, not security): 1 GiB heap per worker and a 10 s event-loop watchdog, configurable per artifact.
- **Ports:** the gateway port and each artifact's port are leased per home and reused across restarts. A conflict at start-up gives a diagnostic and a re-lease.

*Source:* M7 Q14. *Resolves* ARCHITECTURE §4 eviction, limits and home location.

### D63. Long-lived artifacts are first-class
One-off artifacts (approve a report, choose a prototype, answer questions) and long-lived ones (a personal dashboard open all week, a company dashboard, an AI task manager) carry equal weight in design, verification and evaluation. The model handles both with these additions:
1. **Artifact-scoped state.** A field declares `scope: "viewer"` (the default: the viewer's draft) or `scope: "artifact"` (shared state that every viewer sees and edits). Agents and hosts read and write artifact state through `mostra state get|set|patch`, the SDK and the protocol. They use the same revisions, compare-and-set and mutation IDs as viewer edits, and overlapping writes surface as conflicts on both sides. Every change emits a durable `state.changed` event that hosts filter (D10: Mostra never decides what wakes an agent).
2. **Submission policy `none`.** Besides `once` (D39) and `epochs`, an artifact can have no submission at all. It then talks to the agent through artifact state, actions and signals, and the shell shows no Submit control. When a policy does submit, the snapshot includes the viewer's draft and the artifact state at that revision.
3. **Following new versions.** The version banner offers "Switch" and "Always follow this artifact". Following is a per-viewer, per-artifact choice the viewer makes once (D09 intact). While it's on, a new version loads automatically unless the viewer has unsaved edits or fields that wouldn't carry over.
4. **Live updates are not durable events.** A live source persists its latest value and, optionally, a ring buffer. Updates travel on the stream as ephemeral notifications with revisions, so a 24/7 dashboard doesn't fill the event log. Producers run while someone is viewing or a host is subscribed. `defineLive({ always: true })` keeps one running regardless.
5. **Capability lifetime.** Local capability URLs don't expire by default; they are revocable and rotatable. Public shares keep short default lifetimes (D47). Tailnet shares may be long-lived.
6. **Always-on.** `mostra daemon install` (D62) is the documented path for artifacts that must answer at any hour. `mostra doctor` reports when artifacts with policy `none` exist without it.
7. **Growth over months.** Versions share content-addressed assets. Event compaction (D47) and `mostra gc` keep a long-running home bounded, on request.
8. **Coverage.** PRODUCT gains journeys J11 (personal dashboard) and J12 (team task manager). Templates, the conformance kit and agent evaluations include long-lived scenarios.

*Source:* M7 note (direction approved by Mirza). The details are C03-A's design, to be confirmed in round 3.

### D64. Running evaluations in small batches
Evaluation runs never fire as one big batch. The first run of a new harness is a single call, to find bottlenecks and calibrate token use. Later runs go two or four at a time, so a shared five-hour usage limit is used steadily rather than exhausted part-way through. A second account may be used if available. Runs with Claude models are planned with Mirza first (D34). The v1 evaluations drive the **Codex CLI** (`codex exec --json`, ChatGPT OAuth). That choice is deliberate:
- Codex is one of Mostra's target harnesses (D11).
- It runs non-interactively with isolated working directories and reports token usage per turn.
- Jcode's sub-agents aren't ready for this use (D49).

*Source:* M7 Q1.

### D65. Round 3 shapes (delegated)
Mirza approved every shape in [rounds/ROUND-3.md](rounds/ROUND-3.md) as written. Those sections are the record and are carried into the dossier unchanged:
- kit components resolving without copying, and `mostra add` copying one for editing (§1.1);
- the warm set, with maps, 3D and Excalidraw installed on demand (§1.2);
- one token system mapped to the MCP Apps variables (§1.3);
- the questionnaire (§1.4) and review sets with a trusted Choose control (§2);
- the `Timeline`/`Clip`/`useFrame` composition primitive (§3) and the Slidev-style MDX deck grammar (§4);
- terminals declared in the manifest, the frame model, node-pty in a PTY host process, and web demos with bridge injection on by default (§5);
- the six v1 contract packages, the plugin manifest, packs, and the loading and conflict rules (§6);
- the internal `RenderMode` contract (§7) and the shell bridge message set, with a host-replaceable shell (§8);
- the `verify` code scheme, smoke-test scope, regression baseline, viewports and warm browser (§9);
- harness plugins and MCP Apps conformance scope (§10);
- package map P2 (§11.1), the repository standards (§11.2) and the publication pipeline (§11.3).

*Source:* M8 Q3.

### D66. Long-lived additions confirmed
D63 is confirmed as written: two configurations of one model, set mainly by the submission policy and field scope. *Source:* M8 Q1.

### D67. Direct npm publishing from a protected environment
Releases publish when the Changesets release pull request merges. The workflow runs in a protected GitHub environment that only that merge can trigger. npm trusted publishing is configured for direct `npm publish` with provenance, and each package is set to "Require two-factor authentication and disallow tokens". crates.io uses trusted publishing through `rust-lang/crates-io-auth-action`. *Rejected:* stage-only publishing, which needs Mirza's 2FA on every release (D36). *Source:* M8 Q2.

### D68. Design freedom with a beautiful baseline
Artifacts have no imposed look. An artifact's design is entirely the authoring agent's choice: any styling, fonts, layout, motion, libraries, or none of the kit at all. The kit and its tokens are a **baseline** that makes the result beautiful when an agent with no design skill uses the defaults. Every kit component is restyleable through tokens, `className` and copy-source editing, and nothing in Mostra enforces kit usage. The shell is deliberately quiet so it never competes with the artifact. The round-4 shell prototype is a **direction**, not the final visual design; the final pass happens in the shell's WP with design-focused review (Mirza may supply design skills). *Source:* M8 Q4.

### D69. Skill trigger
The Agent Skill's description triggers on one branch: **the agent wants to communicate visually with the user**. That covers every case (asking, showing, deciding, reporting, demonstrating, keeping something up to date), since the uses are unbounded. The rest of [rounds/ROUND-4.md](rounds/ROUND-4.md) part B (purposes, boundaries, structures and leading words) is agreed, and full drafts are iterated with Mirza. *Source:* M8 Q5.

### D70. Two frame-session modes behind the addressing port (delegated, extends D38)
- **Cookie mode** (D38) applies wherever the shell and the artifact are same-site: loopback ports, Tailscale Serve and Funnel (one device hostname, different ports).
- **Worker mode** applies wherever they are cross-site. In v1 that means Cloudflare quick tunnels, because `trycloudflare.com` is a public suffix and each tunnel is its own site. Hosted mode (v1.x) uses the same mechanism. The flow:
  1. The shell loads the frame at `/_mostra/enter#t=<frame token>`.
  2. The bootstrap page registers Mostra's service worker at scope `/`.
  3. The worker attaches the frame session header to every same-origin request.
  4. Event streams and WebSockets bypass the worker and authenticate with single-use tickets from an authenticated POST.

  Origin and CSRF checks are unchanged in both modes.
- **Constraint in worker mode:** the artifact can't register its own root-scope service worker. The client runtime turns such an attempt into a diagnostic rather than silently breaking the session.
- The addressing port decides the mode per origin pair. Artifacts never see the difference.

*Evidence:* VERIFIED_FACTS, cross-site frames (all engines and real Safari). *Source:* round-1 Q5 delegation (M6); found while designing HY-05 on 2026-10-10.

### D71. Ledger engine: SQLite through better-sqlite3 (Default)
The home's ledger is one SQLite database in WAL mode with `synchronous=FULL`, opened only by the supervisor, through `better-sqlite3` (MIT, prebuilt for the v1 platforms). `node:sqlite` replaces it when Node marks it stable; the store module hides the driver, so the switch is internal. *Evidence:* VERIFIED_FACTS. *Strength:* Default.

### D72. Default shadcn base: Base UI (decided by evaluation, D27)
Base UI is the default base. EVAL-01 found no first-pass difference between Base UI and Radix for GPT-6.1-Sol: 17 of 20 each, no cross-base type errors in 40 runs. The secondary factors decide: Base UI is shadcn's own default (along with its docs, Skills and `llms.txt`), most new shadcn projects choose it, and the model used its `render` prop correctly every time. Radix stays a fully supported base (D27). Two consequences of the same evaluation:
1. **`verify` severity.** Smoke-test observations without a runtime error are warnings, and only definite failures are errors. False positives made agents break working code.
2. **Warm set.** `@hookform/resolvers` joins the warm set (D65).

*Evidence:* [evaluations/eval-01/EVAL-01.md](evaluations/eval-01/EVAL-01.md), including EVAL-01b (Claude Sonnet: 6/6 in both bases, D75). *Overturn:* a first-pass gap of 10 points or more in Radix's favor on any model in the D34 mix. *Source:* D27, D34; Mirza may veto at design approval.

### D73. Design approved; C03-B threshold
Mirza approved the complete C03-A design at M9, recorded in [DESIGN_ACCEPTANCE.md](DESIGN_ACCEPTANCE.md). C03-B can start once WP-14 is accepted. That threshold may move to a later package if implementation reorders work; the move is recorded here, and nothing in C03-B's needs (JCODE_HOST) may move out of the packages before it. *Source:* M9 Q1, Q2.

### D74. Agent-facing prose is drafted in the WPs that build it
The Skill and AGENTS.md texts are drafted in WP-14, the MCP tool descriptions in WP-15, and CLI help and diagnostic hints in the package that adds each command or code. Each is iterated with Mirza until he accepts it (STANDARDS prose, D69). *Source:* M9 Q4.

### D75. EVAL-01b: Claude check of the default base
A Claude Sonnet run of EVAL-01 (6 prompts × 2 bases, in pairs, through Claude Code signed in with Mirza's OAuth account) checks D72 across model families, as D34 asks. Mirza approved the batch at M9. D72's overturn rule applies to its result. *Source:* M9 Q3.

### D76. GitHub repository and pre-acceptance pushes
Standing authorization for everything planned on Git and GitHub:
- **The design session** creates the public repository `mostra-dev/mostra` (D13) and pushes `main` with the accepted dossier.
- **WP sessions** may push their `wp/NN-*` branches and open pull requests before acceptance, so CI evidence exists when Mirza reviews.
- **WP-01** may configure the repository as REPO_STANDARDS requires: private vulnerability reporting, secret scanning with push protection, branch protection and required checks on `main`, the protected `release` environment, Actions permissions, CODEOWNERS, labels and Pages.

Merging to `main` and publishing packages still follow acceptance (D36). Deleting the repository, transferring it, or making it private would still need Mirza's explicit approval (STANDARDS). *Source:* M10.

## Research consensus adopted

These points were presented as the converged research findings and approved as a set at M5. The decisions above carry their details.

| Area | Adopted | Decision |
|---|---|---|
| Positioning | Agent artifact runtime with three delivery targets; compile to MCP Apps | D07 |
| Runtime | Vite 8 + React 19 SPA + server functions on Hono; RSC later as opt-in mode | D18, D19 |
| Process model | Private Node LTS sidecar, supervisor plus per-artifact workers, stdio JSON-RPC to hosts | D18 |
| Isolation | Origin per artifact, port fallback, separate trusted shell origin | D21 |
| State | Revisioned drafts, append-only events, immutable bound submissions, SSE down / HTTP up | D22 |
| Review | Outer-shell overlay, multi-resolution anchors | D23 |
| Kit | Brief 3 defaults; non-OSI engines plugin-only | D26 |
| TUI | Frame model + owned renderer, xterm.js live, asciicast v3, Ratzilla, capture crate | D28 |
| Agent loop | `verify`, JSON diagnostics, Skill + AGENTS.md, regression across turns | D29 |
| Remote | Stateless dual-version remote MCP, sandbox port, PSL user-content domain (v1.x and later) | D12 |
| Extensions | Hybrid npm plugins + copy-source packs, metadata registry | D30 |
