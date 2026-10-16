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
| M11 | 2026-10-10T18:49:28.119Z | WP-01 questions. Approved the Crockford alphabet for version IDs ("I trust you to make the most robust decision"), the first host protocol revision `2026-10-10`, protected `main` with no bypass, installing Renovate himself, and the REPO_STANDARDS §4 correction. Contact address mmirzabicer@gmail.com; his surname is Biçer ("c" is fine for compatibility). Delegated the agent-facing prose and asked that branch protection, pull requests, CI and publishing all be done "in the **best** manner possible", acting where possible and instructing him otherwise. |
| M12 | 2026-10-10T19:49:22.550Z / 20:07:46.058Z | Accepted WP-01. Left the pre-merge review to the agent's judgement: `codex review` with GPT-6.1-Sol, GitHub Copilot review (integrated into CI if GitHub allows), or neither, and asked that future WPs build reviews into CI or the documented workflow. Claude Opus 5.5 may review truly substantial packages, at most 20% of Mostra's WPs. Copilot review may need organization credits; not important. |
| M13 | 2026-10-11T04:37:16.061Z | WP-02 questions. The C03-A design expert answered at Mirza's request (his message of 2026-10-11T04:32:46.030Z), and Mirza agreed with every point: the ledger lock as the home's authority, with `instance.json` for discovery and a self-healing socket; the XDG fallback with a `MOSTRA_RUNTIME_DIR` override; the socket name; one JSON-RPC core in `@mostra/protocol` without batches; the `mostra/initialize` shapes with `HomeConfig.path` as a check; the runtime binary and module layout; the `integration` CI job; signal handling and `mostra/shutdown` for attached clients, with idle exit left to WP-08; and a prose review limited to five hints and `packages/runtime/AGENTS.md`. These fill gaps and change no approved decision. |
| M14 | 2026-10-11T11:52:42.559Z | WP-03 questions. Delegated the version-identity collision, the publish receipt's URL before the gateway (asking that every change later packages must make be noted where those packages will see it), the warm-set package, the diagnostic area for artifact lookups and the check boundaries, each with "I trust you to make the most robust … good-engineering decision". Confirmed that the gated child launcher (issue #7) belongs in WP-03 and that WP-02 left it out of the specification. Delegated the agent-facing prose, to be brought for review only where the agent isn't confident, at the very end before the merge. |
| M15 | 2026-10-13T16:02:32.247Z | WP-04 questions. Delegated all eight (the installer's pnpm line, where the working lockfile lives, `mostra add` before the CLI exists, a release-age cooldown, lifecycle scripts, offline mode and the policy, the warm set's form, the prose review) with "I trust you to make the most robust … good-engineering decision". Asked why pnpr is excluded, and accepted pnpm 10 provided it costs no robustness, quality, performance or capability. No one uses the CLI before WP-15, so a CLI command may arrive later. Prose comes to him only where the agent isn't confident. |
| M16 | 2026-10-14T09:17:25.908Z | WP-05 questions. Delegated all ten with "I trust you to make the most robust, appropriate, high-quality, enterprise-grade … good-engineering decision": the check boundaries for the `mostra doctor` warning, MCP over HTTP and `mostra dev`; the `action:*` scope; rotation; the `viewer` parameter; the URL and session shape; framing ("Brilliant catch!"); one version per browser and artifact origin; the bind flag. Asked that every split between packages costs no robustness and never limits the later package. The Claude Opus review is decided at the end of the package. |
| M17 | 2026-10-14T19:33:32.530Z | WP-05's Claude Opus review (13 findings). Delegated all three questions with the same words: a link that names a version opens only that version; the frame can't navigate the viewer's tab, with `ui/open-link` instead; signals need a scope of their own. Asked for the balance between robustness, quality, capability and good code on one side and security on the other. |
| M18 | 2026-10-15T08:07:02.531Z | WP-06 questions. Delegated all eight (check boundaries, the policy in force, epochs, views, the `viewer` parameter, delivery owners and mirrors, prose, the first browser-protocol revision) with "I trust you to make the most robust, appropriate, high-quality, enterprise-grade, top-notch, well-fit, well-thought and considered, reliable, future-proof and foolproof, well-informed, good-engineering decision", and asked that each be brainstormed meticulously. |
| M19 | 2026-10-15T12:39:18.647Z | WP-07 questions. Delegated all eight (the channel policy's source, the orphan model, defaults the viewer saw, check boundaries, prose, the Claude review, `window.storage` limits, Choose's candidates) with "I trust you to make the most robust … optimal decision", asking for the most robust, highest-capability choice in each. Raised the Claude Opus review limit to ten of Mostra's packages. Rules aren't frozen: one that is unnecessary or significantly limits capability can be discussed. Work that later packages build on is done so it helps them as a baseline and never limits them. |

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

### D77. Version IDs use Crockford base32 (delegated)
`versionId` is `ver_` plus the first 26 characters of the SHA-256 digest of `sourceDigest ‖ envDigest` in Crockford's base32 alphabet (`0-9A-HJKMNP-TV-Z`, uppercase, most significant bit first), 130 bits. Every Mostra ID body then uses the one alphabet ULIDs use, so parsers, logs and copy-paste behave alike, and the letters I, L, O and U never appear. `VersionId.fromSha256` in `@mostra/protocol` is the single encoder. *Source:* M11 Q1 (delegated). *Fills* DATA_MODEL §2, which named "base32" without an alphabet.

### D78. The first host protocol revision is `2026-10-10`
`HOST_PROTOCOL_REVISIONS` in `@mostra/protocol` starts at `2026-10-10`, the date WP-01 defined the protocol's foundations. Later work packages extend it additively; a breaking change adds a newer revision (D32, D59). *Source:* M11 Q2.

### D79. `main` is protected; everything lands through pull requests
`main` takes changes only through pull requests that pass the `ci-ok` check and code scanning, merged with merge commits. Force pushes and deletion are blocked, and nobody bypasses the rules, including administrators. The progress report a WP finalizes after acceptance therefore reaches `main` through its own small pull request that merges when green. Release tags can't be moved or deleted. *Source:* M11 Q3. *Changes* the publication step of work-packages/README.md §4, which said "push".

### D80. Independent reviews before acceptance
Every work package gets an independent code review before it is presented to Mirza, and every finding is fixed or answered in the progress report:
1. **GPT-6.1-Sol through `codex review`**, effort high, on the pull request's diff. A GPT-only live call, announced as D34 requires, with its tokens recorded.
2. **GitHub Copilot code review** runs automatically on every push to a pull request (the `main` ruleset). Its comments are review threads, and the ruleset requires every thread resolved before merging.
3. **Claude Opus 5.5** also reviews the truly substantial packages, up to ten of Mostra's packages (D114; at first at most one in five). It waits for Mirza's approval like every Anthropic batch (D34).

Reviews find defects; they never replace the evidence table. The WP-01 review (13 findings, all fixed with regression tests) showed the value: a green gate suite still had false negatives. *Source:* M12.

### D81. The ledger lock decides who owns a home
A supervisor owns a home by holding an exclusive SQLite lock on its ledger (`locking_mode=EXCLUSIVE` in WAL mode), taken with a write transaction before anything else in the home is used. The operating system releases the lock when the process dies, so it never goes stale, and any second opener fails at once. The control socket is only how clients find the owner:
1. The owner unlinks any leftover socket file at its path and binds a new one. No takeover mutex is needed, because only the lock holder touches the socket.
2. After binding, the owner writes `instance.json` in the home (a temporary file, then a rename) with its PID, process start time, socket path, runtime version and protocol revisions, and removes it on a clean exit. The file is for discovery only, never a lock. It is stale when its PID and start time don't match a live process.
3. A starter that can't take the lock reads `instance.json` and attaches to the socket recorded there. Only when that socket can't be reached does it fail with `MOSTRA_HOME_LOCKED`, naming the owner's PID and how to restart it. `mostra host` never attaches to another instance: it reports `MOSTRA_HOME_LOCKED` with the owner's PID.
4. A running supervisor checks its socket at least every 10 s and re-creates it when the file has disappeared, for example when a Linux logout removes `$XDG_RUNTIME_DIR`.

Consequence: every ledger reader, including `mostra doctor`'s integrity check, goes through the supervisor or runs only when no supervisor holds the lock. *Supersedes* the `run/takeover.lock` mutex in FAILURE_MODEL §2 and WP-02's original design detail. *Strengthens* D45 and D71. *Source:* M13 points 1 and 6.

### D82. Runtime directory and socket name
The control socket is `<runtime dir>/<home hash>.sock`:
- **Runtime directory.** `MOSTRA_RUNTIME_DIR` when set. Otherwise `~/.mostra/run` on macOS. On Linux, `$XDG_RUNTIME_DIR/mostra` when `$XDG_RUNTIME_DIR` is a directory the user owns with mode 0700, else `${XDG_STATE_HOME:-~/.local/state}/mostra/run`. Mostra creates its directory with mode 0700. A directory owned by someone else fails closed with `MOSTRA_HOME_NOT_OWNED`. Two starters with different environments may compute different directories; `instance.json` (D81) is how they find each other.
- **Home hash.** The first 16 characters, in D77's Crockford base32 alphabet, of the SHA-256 of the home's real path, so a symlinked home maps to the same socket.
- **Length.** A socket path over the operating system's limit (103 bytes on macOS, 107 on Linux) fails closed with `MOSTRA_HOME_SOCKET_TOO_LONG`, whose hint names `MOSTRA_RUNTIME_DIR`.

*Source:* M13 points 2 and 3. *Fills* ARCHITECTURE §4 and DATA_MODEL §1.

### D83. One JSON-RPC 2.0 core in `@mostra/protocol`
`@mostra/protocol` holds the one JSON-RPC 2.0 implementation every Mostra connection uses: message schemas, request correlation, notifications, timeouts, connection close, and errors carried as diagnostics. The host protocol server and its clients, child-process messaging and the shell bridge all use it. It has no I/O and no Node built-ins, works in the browser and is tree-shakable; size-limit gates the browser packages that import it. Revision `2026-10-10` has **no batches**: a batch is answered with an Invalid Request error (-32600) carrying a diagnostic. Batches can be added later without breaking anything, and MCP dropped them too. *Source:* M13 point 4.

### D84. The `mostra/initialize` shapes
- **`capabilities`.** The client lists the notifications it accepts. The instance lists its methods, the notifications it sends and the ports it supports.
- **`HomeConfig.path` is a check, not a setting.** The supervisor resolves its home at process start (`--home`, then `MOSTRA_HOME`, then the platform default; an SDK passes its `home` option as `--home`) and has locked it before `mostra/initialize` arrives. When `HomeConfig.path` is present and names a different home, initialization is refused with `MOSTRA_HOME_MISMATCH`.
- **`instance`** also reports the supervisor's `pid` and its `mode` (`host` or `daemon`).
- **Ports.** Registering a port the instance doesn't implement, including the reserved `ai` (D46), returns a warning. It is never a silent no-op.

*Source:* M13 point 5. *Fills* INTERFACES §6.

### D85. The runtime binary and module layout
- **Binary.** `mostra-runtime host|daemon` is the runtime bundle's entry point. `mostra host` is `mostra-runtime host`, so the Rust crate and the SDK spawn it directly from the bundle, and `mostra daemon start` runs `mostra-runtime daemon`.
- **Modules.** `@mostra/runtime` gains the modules `home` (resolution, permissions, the runtime directory and acquisition) and `instance`. `instance` is the composition root only: it assembles the other modules and holds no policy of its own.
- **Home permissions.** A home the user owns is tightened to mode 0700, and the supervisor logs that it did. A home owned by someone else fails closed with `MOSTRA_HOME_NOT_OWNED`, because Mostra keeps secrets there (D44).

*Source:* M13 point 6. *Fills* REPO_STANDARDS §3 and INTERFACES §6.

### D86. An `integration` CI job on macOS and Linux
Suites that run real Mostra processes (sockets, process groups, start times) run in an `integration` job on both macOS and Linux. The plan job runs it only when the runtime or the protocol is affected, so pull requests stay inside the 10-minute target (D50). Later packages add their real-process suites to this job. *Source:* M13 point 7. *Fills* REPO_STANDARDS §6.

### D87. Stopping an instance
SIGTERM and SIGINT stop an instance cleanly: in-flight ledger transactions finish, children stop, and the socket and `instance.json` are removed before it exits 0. `mostra/shutdown` is available to attached clients of a daemon as well as to the spawning host. The socket is owner-only, so every attached client is the same user, and `mostra daemon stop` uses the method. Idle exit after 30 minutes stays with WP-08 (RT-08, D62). *Source:* M13 point 8. *Amends* INTERFACES §6, which said "host-spawned only".

### D88. Prose review for WP-02
Mirza delegates WP-02's diagnostic wording as at M11, except for the hints a person is likely to read when something goes wrong. He reviews those in the candidate: `MOSTRA_HOME_LOCKED`, `MOSTRA_HOME_NOT_OWNED`, `MOSTRA_HOME_SOCKET_TOO_LONG`, `MOSTRA_HOME_TOO_NEW` and `MOSTRA_PLATFORM_UNSUPPORTED`. `packages/runtime/AGENTS.md` is shown in full, because agents read it in every later package. *Source:* M13 point 9.

### D89. Version identity covers the artifact (delegated)
`versionId` is `ver_` plus the first 26 Crockford base32 characters (D77) of the SHA-256 of the artifact ID's UTF-8 bytes, one `0x00` byte, the 32 bytes of `sourceDigest` and the 32 bytes of `envDigest`. Publishing the same source in the same environment for the same artifact still returns the existing version (`reused: true`), and a bundle imported into another home keeps its version ID because it keeps its artifact ID (RM-01). Two artifacts with identical files, such as a copied directory bound by path, now get two versions instead of colliding on `version.id`. *Source:* M14 Q1 (delegated); found by WP-03. *Amends* D77 and DATA_MODEL §2, which hashed `sourceDigest ‖ envDigest` only.

### D90. The publish receipt and events before the gateway (delegated)
- `PublishReceipt.url` is optional on the wire. The capability URL needs the gateway, its leased ports and tokens (WP-05), so WP-03's receipts have none. WP-05 sets it on every publish, and from then on every receipt carries it. The field stays optional, so the schema never changes; hosts use it when present.
- WP-03 creates DATA_MODEL §3's `event` table and appends `artifact.created` and `version.published` in the publish transaction, as ARCHITECTURE §3 step 6 says, so the receipt's `cursor` is real from the start. WP-06 adds reading, filters, subscriptions and the other event types on the same table.
- Whatever a later package must change because of this is written into that package's specification (WP-05, WP-06), so its session sees it.

*Source:* M14 Q2 (delegated, with the request to note follow-ups where later packages see them).

### D91. The warm set is the package `@mostra/warm` (delegated)
The warm set (ROUND-3 §1.2) is an unpublished workspace package, `packages/warm`, whose dependencies are exactly the warm packages and which contains no code. The builder links each build's `node_modules` to it, so artifacts resolve the warm set with no `package.json` and one React copy, and `@mostra/runtime` keeps no dependency on React (REPO_STANDARDS §3). WP-03 starts it with what WP-03's builds need (`react`, `react-dom`, `react-router`, `tailwindcss`, `@mostra/react`); WP-04 turns it into the pre-built warm layout of the shared store and adds the rest of the warm set; WP-11 ships it in the runtime bundle. *Source:* M14 Q3 (delegated). *Amends* the package map (REPO_STANDARDS §3).

### D92. The `ARTIFACT` diagnostic area (delegated)
INTERFACES §13 gains the area `ARTIFACT` for finding and creating artifacts: an unknown artifact or source path, a source that no longer exists, a directory that isn't empty, an unknown template. Every method that takes an `ArtifactRef` or a `SourceRef` reports these codes. *Source:* M14 Q5 (delegated).

### D93. WP-03's check boundaries and prose
- **Boundaries.** Some WP-03 checks name features later packages build: `verify` in AU-01 and AU-02 (WP-09), results in AU-04 and VR-11 (WP-06), regression baselines in VR-11 (WP-09), and verify and action calls in RT-02's process audit (WP-08, WP-09). WP-03 proves everything else through the real interfaces. Each of those packages extends WP-03's fixtures and audit to its feature, as its specification says.
- **Issue #7.** The gated child launcher, which records a child before it may run its command, is WP-03's (it was left out of WP-03's specification by mistake).
- **Prose.** The agent-facing prose of WP-03 is delegated (as at M11). The agent brings Mirza only the texts it isn't confident in, at the very end, when the pull request is about to merge.

*Source:* M14 Q4, Q6, Q7.

### D94. The install child runs pnpm 10 (delegated)
Mostra's package installs run pnpm 10 (`pnpm` 10.34, MIT), not the repository's pnpm 12:
- **Why the `pnpr/` rule exists.** Everything users install is Apache-2.0 over OSI-licensed components (D14, invariants 8 and 9), and the runtime bundle ships the installer (WP-11). pnpm's `pnpr/` directory is under PolyForm Shield 1.0.0, which isn't an OSI license (it forbids competing products), so shipping its code would put non-OSI terms inside Mostra (D20, DP-06).
- **Finding (2026-10-13).** pnpm 12's native binary (`@pnpm/exe.<platform>`, npm license MIT) statically links `pnpr-registry`, `pnpr-package-name` and `pnpr-error` through `pnpm-config`. Those crates sit in `pnpr/crates/` with `license-file = "../../LICENSE.md"`, the Shield text. pnpm 11's JavaScript bundle contains `pnpr/client`, declared MIT but inside the directory the pnpm README puts under Shield. pnpm 10.34 contains no `pnpr` code at all ([VERIFIED_FACTS](VERIFIED_FACTS.md#wp-04-re-verification-2026-10-13)).
- **Nothing is lost.** pnpm 10 has every capability WP-04 uses: the content-addressed store, offline and frozen installs, `link:` peers, lifecycle scripts, `minimumReleaseAge`, `--lockfile-only` and the NDJSON reporter. It is maintained (`latest-10`; 10.34.7 on 2026-10-12) and was faster in the prototype (2.5 s against 4.4 s for pnpm 11 on the same install). The installer is internal to the `deps` module, so a later switch changes no interface.
- **Enforced.** The license audit refuses `pnpm` 11 or later and every `@pnpm/exe.*` package in the core's dependency tree.
- **Repository tooling stays on pnpm 12.** It is a development tool that Mostra never distributes, and Shield permits every use that doesn't compete with pnpr.

*Overturn:* a pnpm release whose published artifacts contain no `pnpr/` code, or pnpm 10 ending its security releases. *Source:* M15 Q1 (delegated; the capability condition holds).

### D95. The dependency model (delegated)
How DP-01 to DP-05 work, filling what DATA_MODEL and INTERFACES left open:
1. **The warm layer.** The warm set (D91) stays one pre-built, read-only layout. An artifact that imports nothing beyond it builds straight against it, with no install. An artifact with on-demand packages builds against a lock layout, `deps/locks/<lockDigest>/`, whose `package.json` links every warm package through one `warm` symlink (`link:warm/<name>`). pnpm then resolves every peer dependency on React, or on any warm package, to the single warm copy, so one React holds by construction, and the installer's lockfile carries no machine paths.
2. **The working lockfile.** Each artifact has one working lockfile in the ledger (`dependency_lock`), keyed by its artifact ID, or by its source path until its first publish binds it (re-keyed inside the publish transaction). Publish, `verify` (WP-09) and `deps/add` read and write it, so they agree on versions. Publish freezes it into `versions/<id>/lock.yaml`. Mostra never writes into the artifact's source.
3. **The lockfile format.** WP-03's `lock.yaml` grows additively. When the artifact has on-demand packages it gains `packages` (each direct on-demand package with its exact version) and `pnpm` (the installer's lockfile text, which pins the whole graph). An artifact without them keeps WP-03's form. `lockDigest` is the SHA-256 of the text.
4. **Resolution.** Package imports are found statically in the snapshot, never by running code: static, dynamic and `require` imports and `@jsxImportSource` pragmas in scripts, ESM blocks in MDX, `@import`, `@plugin` and `@reference` in CSS. Every pin is exact: a new package resolves through `pnpm add --save-exact`, and the working lockfile seeds everything already resolved, so a republish is reproducible and works offline. Packages added with `deps/add` stay in the lockfile whether or not the source imports them yet.
5. **Policy.** `HomeConfig.dependencies` is `"auto"` (the default) or `"explicit"`, persisted in the home's `config.json`. Under `"explicit"` only `deps/add` adds packages, and an import of anything else is `MOSTRA_DEP_MISSING` at the import's location, with the exact command.
6. **`mostra add`.** WP-04 delivers it as the host protocol method `deps/add`. The CLI command (WP-10) is a thin client of it: `mostra add <package…> [--artifact <path|id>]`, defaulting to the artifact in the current directory.
7. **Release age.** A package resolved without an exact version takes the newest release at least one day old (pnpm's `minimumReleaseAge`, 1440 minutes). That holds back a freshly compromised release, not the user: a package named with an exact version in `deps/add` installs whatever its age.
8. **Lifecycle scripts run** for every on-demand package (pnpm's build approval is off), inside the install child: a process the process manager starts in the artifact's source directory with the artifact environment, an allowlist (`PATH`, `HOME`, `TMPDIR`, locale, time zone, the user's name and shell, the native-build toolchain variables such as `CC` and `XDG_CACHE_HOME`, proxy and certificate variables, `npm_config_*`). Nothing else of the supervisor's environment reaches it.
9. **Offline.** Mostra is offline when `MOSTRA_OFFLINE` is set, when no non-loopback network interface is up, or when the registry can't be reached. A package the home's store doesn't hold then fails with `MOSTRA_DEP_OFFLINE`, naming it. When the store index already shows that, the supervisor answers before any child starts. An install is stopped after 300 s with `MOSTRA_DEP_TIMEOUT` (FAILURE_MODEL §9).

*Rejected:* declarations in a `package.json` or a manifest field (a single-file artifact has nowhere to put them, and verify and publish wouldn't share pins); copying the warm packages into every lock layout (a second React per layout unless deduplicated); finding imports by building first (a failed build per new package, and no answer within DP-04's second). *Source:* M15 Q2 to Q7 (delegated).

### D96. WP-05's check boundaries (delegated)
Each split leaves the later package free: WP-05 builds nothing the later package would have to work around.
- **LL-05's doctor warning.** WP-05 proves that local capability URLs don't expire and stay revocable and rotatable. The `mostra doctor` warning about long-lived artifacts (policy `none`, D63) in a home without an always-on daemon is WP-10's, which owns `doctor`, built on WP-08's `mostra daemon install`: doctor reads the artifacts' policies through `artifact/list` and looks for the login-service unit WP-08 installs for the home.
- **HY-01 item 13, MCP over HTTP.** The request checks (exact Host, exact Origin, JSON content type with the CSRF header, request-target and header sanity) are pure functions in `@mostra/protocol` (`hygiene`), with no I/O, so the gateway and WP-15's `mostra mcp --http`, a separate process, apply the same code. WP-15's HTTP hygiene tests close item 13 on that transport.
- **VR-03 and `mostra dev`.** WP-05's route enumeration covers everything the gateway serves. WP-10 adds `mostra dev`, on its own port and never behind a capability URL, to the same enumeration.
- **Routes later packages implement.** The gateway declares every route of INTERFACES §4 with its scope and checks now, so a view-only session is refused on `/submit` or `/call/…` before any handler exists. WP-06, WP-07, WP-08, WP-13 and WP-20 attach handlers behind the declared checks and repeat the scope tests with real handlers.
- **RT-05.** WP-08 keeps WP-05's zero-worker test green: a worker starts only for a version with server code.

*Source:* M16 points 1 to 3.

### D97. Capability links (delegated)
1. **Form.** `http://<url host>:<shell port>/a/<artifactId>[/v/<number>]#t=<secret>`; the URL host is `127.0.0.1` unless D99's flags say otherwise. The secret travels in the fragment, so no server, log or `Referer` sees it. The shell posts it to its exchange endpoint and removes it with `history.replaceState`. Without `/v/<number>` the link opens the artifact's latest version.
2. **Tokens.** A token is a `tok_` ULID and a secret of 26 Crockford base32 characters (130 bits): HMAC-SHA-256 of the token ID under the home's capability key, 32 random bytes in `<home>/keys/capability` (mode 0600). The ledger stores only the SHA-256 of the secret, so a copy of the ledger grants nothing. Deriving the secret lets Mostra show a link it minted again without storing it. A lost key changes nothing for existing links, which verify by hash; Mostra writes a new key and mints a new default link.
3. **The default link.** Each artifact has one default link: every scope, no expiry. Every `PublishReceipt.url` is that link, so it stays the same across publishes and `requestId` replays, and the receipt gains an optional `tokenId` to rotate or revoke it. `view/url` always mints a new token.
4. **Scopes.** `view` (every token has it), `draft`, `submit`, `review`, `signal`, `action:*`, `action:<export>` (that export of any `"use server"` module) and `action:<module path>#<export>` (one function ID). `view/url` defaults to every scope. `signal` joined after the Claude review (M17): a signal may wake an agent (D10), so a view-only link must not raise one.
5. **Expiry.** `ttl` is a duration (`30m`, `24h`, `7d`); local links have none by default (D63). An expired or revoked token, and every session made from it, answers 410 with `MOSTRA_HYGIENE_TOKEN_REVOKED`.
6. **Rotation.** `view/rotate { tokenId }` mints, in one transaction, a token with the same artifact, scopes and expiry and revokes the old one, appending `token.revoked`. Rotating the default link makes the new token the default.
7. **Viewer.** `view/url`'s `viewer` arrives with WP-06, which first records viewers; until then every session is the home's local user.
8. **Guessing.** Failed capability tokens count per artifact; past 30 in a minute, every token for that artifact gets 429 with `Retry-After` until the window clears. A correct token is refused too while the limit holds, so a guess can't succeed during an attack, and the limit is checked in the same step as the token, so guesses sent together can't slip past it. Tokens for artifacts the home doesn't have share one count. Frame tickets don't count: they are single-use 130-bit secrets that live a minute, and any page on the host could spend a count by loading an entry URL. A frame entry the browser marks `Sec-Fetch-Site: cross-site` is refused (403) before its ticket is looked at (found in WP-05's review). *Amended after the Claude review (M17):* the limit was one per gateway and counted frame entries, so one artifact's page could lock every viewer of every artifact out.
9. **A link that names a version opens that version only** (M17). Its shell asks for no other version (403 `MOSTRA_HYGIENE_SCOPE_DENIED`), and its frame gets no file of another version through D98 item 5's asset fallback. A link without a version follows the latest. Rotation keeps the version, as it keeps the scopes.
10. **A link works only at the shell address it was minted for** (M17). A token records its shell origin; when the shell moves to another port (a lease another program took, D99), old links answer 410, because whoever holds the old port could read their secrets from the fragment. The default link is minted again at the new address, and old links work again if the gateway returns to the old one.

*Source:* M16 points 4 to 7.

### D98. Sessions and frames in cookie mode (delegated)
Browsers keep cookies per host, not per port, so every artifact port and the shell share one cookie jar, and a page on one port is same-site to all the others (VERIFIED_FACTS, addressing prototype). The rules follow from that:
1. **One session cookie per origin.** It is named `mostra-<port>`, holds a 26-character random secret (the ledger keeps its SHA-256), and is `HttpOnly; SameSite=Strict`, never `Secure` over loopback HTTP. An artifact's cookie has `Path=/`. The shell's has `Path=/a/<artifactId>`, so each artifact's shell session is separate. `Max-Age` is 400 days, the recommended cap, so a bookmarked page survives a browser restart. Every request checks that the session was issued for this listener's origin and that its token is live.
2. **CSRF.** Each session has a CSRF token, derived from its cookie with SHA-256 under a fixed label, so the ledger keeps only the token's SHA-256, as it does the cookie's: a copy of the ledger can't forge either. Same-origin code reads the token from `GET /_mostra/session` (artifact origins) or `GET /a/<artifactId>/_mostra/session` (shell); every mutation sends it as `X-Mostra-CSRF` with a JSON content type. A double-submit cookie can't work here, because every port can read the host's cookies. (WP-05's hygiene suite found the first version storing a random token in plain text.)
3. **Frames.** The shell posts for a single-use frame ticket (60 s, kept in memory, bound to its session, the artifact's origin and the version); the frame opens `GET /_mostra/enter?ticket=…`, which creates its session (or updates the one it has for the same token) and redirects to `/`. A ticket works only while the shell session that asked for it exists (the binding was missing until the Claude review, M17).
4. **Framing.** The shell sends `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`; artifact documents send `frame-ancestors <shell origin>`. Otherwise one artifact's page, holding the shared cookies, could frame another artifact or its shell and lead the viewer into clicking its buttons or its trusted Submit.
5. **One current version per browser and artifact origin.** Versions are built with base `/`, and agent code uses absolute paths (D38), so an artifact origin serves the version its frame session last entered. Content-hashed files under `/assets/` are served from any version of the same artifact the link may open, so a page keeps loading its chunks after another tab switched versions; WP-07's banner tells the older tab. Every file served comes from a version whose stored files match its output digest; the check runs before a version's first file and again whenever a served file's change time differs (FAILURE_MODEL §3, Claude review finding 5).
6. **Every response** carries `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`, and no `Access-Control-*` header ever.
7. **The frame can't replace the shell** (M17). The frame is sandboxed with every capability a page has (scripts, its own origin and storage, forms, dialogs, popups that escape the sandbox, downloads, pointer lock, presentation, storage access) except navigating the viewer's tab, which would let artifact code swap the trusted shell for a look-alike page and defeat WP-07's trusted controls. The shell keeps only the tokens the browser knows, so WebKit logs no error. The shell page sends `Cross-Origin-Opener-Policy: same-origin`, so the frame's popups have no opener: Firefox lets even a sandboxed popup navigate `opener.top` (VERIFIED_FACTS, WP-05). An artifact sends the viewer elsewhere with `ui/open-link` (MCP Apps, `openLink` in `@mostra/react`), which the shell opens in a new tab without an opener, for `http:`, `https:`, `mailto:` and `tel:` URLs. This withholds one navigation, not a capability: everything the artifact could reach before, it still reaches (D05), and it is what keeps trusted controls trusted (D06).
8. **Another link never silently replaces a session** (M17). One shell session per browser and artifact means opening a second link replaces the first, and any page could send the viewer to its own, narrower link and take over their tabs. When a live session from another token exists, the exchange answers 409 `MOSTRA_HYGIENE_SESSION_CONFLICT` with what each link allows; the shell shows both and lets the viewer keep theirs or use the new one (`replace: true`). The same link again reuses its session, and a session whose link died is replaced without asking.
9. **A full cookie jar** (M17). Every port of the host shares one jar, and any artifact's page can fill it; Chromium, Firefox and WebKit keep about 400 KB per host (VERIFIED_FACTS, WP-05). Listeners accept headers up to 1 MiB, so a full jar still works. Past that a request gets 431 `MOSTRA_HYGIENE_HEADERS_TOO_LARGE`, a page that runs nothing and sends `Clear-Site-Data: "cookies"`, which empties the host's jar; Mostra's sessions come back with the next link.

*Source:* M16 points 7 to 9.

### D99. Binding and port leases (delegated)
- **Bind.** The gateway binds `127.0.0.1` only. `mostra-runtime host|daemon --bind <address>` binds another address; a wildcard address (`0.0.0.0`, `::`) also needs `--url-host <name>`, the host name its URLs use and its Host allowlist accepts. Neither flag is persisted, so every wider start is explicit, and a public share never falls back to it (FAILURE_MODEL §8).
- **Leases.** The shell port and each artifact's port are leased in `port_lease` from 20000 to 32767, below the ephemeral ranges of Linux (32768 to 60999) and macOS (49152 to 65535), so outgoing connections never take a leased port between restarts. Every leased port is bound at start; one taken by another program is leased again with the warning `MOSTRA_ENV_PORT_TAKEN`, and its old URLs stop working (FAILURE_MODEL §8).

*Source:* M16 point 10.

### D100. A `requestId` replays only its own request (delegated, M17)
Every mutating method records a SHA-256 of its parameters (RFC 8785-style canonical JSON without `requestId`) beside the result it records for a `requestId` (DATA_MODEL §3 `request.params_digest`). A retry with the same parameters gets the recorded result, as H-03 requires; the same `requestId` with other parameters is refused with `MOSTRA_HOST_REQUEST_ID_REUSED` (-32000), including while the first attempt still runs. Replaying would answer a request nobody made: `view/url` would hand out a wider link than asked for, another artifact's, or one without the requested expiry (Claude review finding 8). Rows recorded before the column existed replay as before. *Source:* M17; refines H-03.

### D101. WP-06's check boundaries and prose (delegated, M18)
Each split leaves the later package free, as D93 and D96 required:
- **Clients.** WP-06 proves `wait`, `results/get`, `state/*` and events through the host protocol over both transports. `mostra wait`, `results` and `state` repeat those checks through the CLI in WP-10, and `createMostra` through the SDK in WP-11. The conformance scenarios that IN-06 to IN-10, IN-12 and LL-02 name are WP-12's kit, built on the same methods and ports.
- **The shell channel.** The submit transaction serves both channels (D40) and is tested for both. The shell's trusted Submit, the channel policy and the absence of a Submit control under policy `none` are WP-07's (SH-02, IN-13); WP-06 refuses a submit under `none` and serves the artifact channel's route.
- **Signals from actions.** `signal.raised` with `source: "action"` exists and is tested in the interaction module; WP-08's `signal()` in `@mostra/server` calls it.
- **Comments and action runs in results.** `Results.comments` and `Results.actions` stay empty until WP-20 and WP-08 fill them from their tables; the Markdown renderer is proven now by a golden that has every section.
- **Compaction.** The interaction module compacts and every reader reports `MOSTRA_HOST_CURSOR_COMPACTED`; `mostra gc --compact-events` (WP-10) is the command that triggers it.
- **Prose.** The diagnostic hints and `AGENTS.md` additions are delegated as in WP-03 to WP-05: Mirza sees only the texts the agent isn't confident in, before the merge.

Each follow-up is written into its package's specification.

### D102. The submission policy in force (delegated, M18)
The manifest requests a policy and the host decides (D39, D63). At every publish the policy in force is the first of: the publish's `policy`; the policy an earlier publish of the artifact named explicitly (a host's explicit choice sticks until another publish names one); the home's `HomeConfig.submission` (kept in `config.json` like the dependency policy); the manifest's `submission`; `once` with scope `per-artifact`. A `once` without a scope is `per-artifact`. The resolved policy is stored on the artifact and reported by `artifact/get`, and submissions follow the policy in force when they are made. A host such as Jcode can so force `once` whatever an agent's manifest asks, either per artifact at publish or for the whole home, and the standalone CLI honors the manifest. (The sticky explicit choice was added while building: without it, an agent's plain republish silently undid a host's choice.)

### D103. Epochs and `wait --until submitted` (delegated, M18)
- **Epochs are per viewer.** Each viewer's draft carries an epoch, starting at 1. A submit under `epochs` records the draft's epoch, links the submission to the previous one of the same viewer, and moves the draft to the next epoch in the same transaction. The draft's values carry forward, so the viewer edits and submits again; nothing on the page resets.
- **`submitted`** is level-triggered under `once`: any submission of the artifact satisfies it, whatever the cursor, so a wait after the human already submitted returns at once (D11). Under `epochs` it is satisfied by the first submission after the cursor, which defaults to the artifact's latest publish, so a waiting agent is never handed a round it already read. Under `none` it is refused with `MOSTRA_SUBMIT_POLICY_NONE`.
- **The others** (`signal:<name>`, `state:<fieldId>`, `event:<type>`) are edge-triggered after the cursor (ARCHITECTURE §6). `still_waiting` returns the newest cursor the wait examined, so the next wait misses nothing.

### D104. Views and viewers (delegated, M18)
- **A view is one frame load.** The gateway records a view each time a shell asks for a frame ticket: the artifact, the exact version the ticket opens and the viewer, with `view.opened`. The ticket answer carries its `viewId`, which the shell hands its frame over the bridge (WP-07). Mutations and submits name their view, and the server takes the version from the view, never from the frame's session (which another tab may have moved), so a submission names exactly what its tab showed (IN-05, H-10). A view of another viewer or artifact is `MOSTRA_SUBMIT_VIEW_INVALID`.
- **`view/url`'s `viewer`** (D97 item 7) is `{ ref, name? }`: `ref` is the host's own stable key for a person (an email, an account ID), mapped idempotently to one viewer of kind `token`, and `name` its display name, updated when given. The link's sessions act as that viewer; rotation keeps it, and a token's viewer never changes (the token trigger). Without `viewer`, sessions act as the home's local user, one viewer of kind `local`. `once` per-viewer surveys mint one link per person.

### D105. Deliveries and draft mirrors (delegated, M18)
- **Owners.** A submissions port belongs to the host that registers it, named by its `client.name`, so deliveries outlive connections. `HomeConfig.ports` records, per client name, the ports that host always provides (`config.json`; an empty list clears it). A submission gets one delivery per owner that is registered or expected at commit; with neither, it gets one to Mostra's built-in adapter, which accepts at once (D58's standalone default).
- **Order.** Each owner's deliveries go out one at a time in submission order. A retryable failure (`retry: true`, a transport failure, no answer within 30 s) keeps the head pending with backoff from 1 s doubling to 5 min; an owner that isn't connected is retried when it registers again. Accepted is `delivered`; `accepted: false, retry: false` is `undeliverable` for the reason `undeliverable`, `delivered` for `duplicate` (the host already holds it, as ROUND-2's SDK example uses it) and `rejected` otherwise, each with its event. Mostra never retries a terminal answer.
- **Identity.** Each delivery has a stable `deliveryId` (`dlv_` and a ULID) that a redelivery after a crash repeats. The envelope carries `kind: "submission"` and the Results structure built from the immutable submission row alone.
- **Draft mirrors** (`drafts.mirror`) are best effort: each viewer draft's latest revision goes to every connection that registered the port, coalesced while one is in flight, with `kind: "draft"` so no host can take one for a submission (IN-06). A mirror is never retried, and never delivered through the submissions port.

### D106. Fields, signals and the first browser-protocol revision (delegated, M18)
- **Mutations.** A field op conflicts when the field changed after the mutation's `baseRevision`; the other ops apply, and one revision covers them. Viewers always send a base; agents and hosts may omit it to write unconditionally. A mutation ID replays its recorded result and is refused with `MOSTRA_FIELD_MUTATION_ID_REUSED` when sent again with other contents. Ops carry the field's optional `label`, `required` and `sensitive`, which results and event redaction use. A draft closed by a `once` submission takes no further writes (`MOSTRA_SUBMIT_ALREADY`); artifact state stays writable.
- **Submit is a signal.** Every submission also appends `signal.raised` with the name `submit` and its channel as the source, so `signal:submit` and host filters see it like any other signal. Required fields are checked by the shell and the client runtime before submit (WP-07); the server, which can't know which fields a page shows, doesn't guess.
- **The browser protocol.** WP-06 defines revision `2026-10-15` of the browser protocol: the payloads of `fields`, `submit`, `signal`, `events` and `events/poll`, as Zod schemas in `@mostra/protocol`. The gateway serves only revisions it knows. WP-07 builds the client runtime on it and records it in `envDigest`; WP-13 adds the long-poll fallback over tunnels on the same handler.

### D107. Waiting for the next respondent under `once` per-viewer (delegated under M18; found by the Claude review)
Amends D103. Under `once` with scope `per-viewer` (a survey: one submission per person), `wait --until submitted` is level-triggered only when the caller gives no cursor, so "has anyone answered?" returns at once. After an explicit `after` cursor it is edge-triggered, as under `epochs`: the first submission after the cursor satisfies it, so an agent can wait for each next respondent without being handed the first one forever. `once` per-artifact stays level-triggered whatever the cursor (exactly one submission exists or will). *Source:* finding 5 of WP-06's Claude Opus review; Mirza delegated WP-06's interaction semantics at M18, and the choice is shown to him at the candidate.

### D108. The submit channel policy in force (delegated, M19)
Fills D40 and INTERFACES §6 and §7, which name both a home setting and the `trustedControls` port:
- **The home's default.** `HomeConfig.submitChannels` (`["shell"]`, `["artifact"]` or both) is kept in `config.json` like the other settings, so it holds while its host is away. Without it, both channels are allowed (D40).
- **The host's answer per artifact.** When a connected client registered `trustedControls`, the gateway asks its `policy` when a frame ticket is issued, bounded at 5 seconds because the page is waiting. The answer's `submitChannels` and `controls` replace the home's default for that view. A call that fails or times out narrows the view to the shell channel and logs why: a host that took over the policy never has it widened by its own outage.
- **One record per view.** The channels and controls in force are stored on the view (`view.controls_json`), so the shell, the page and the server judge a view by the same answer. The shell renders only the controls the view allows. The artifact's `submit()`, and its writes to `review.<set>.choice`, are refused with `MOSTRA_SUBMIT_CHANNEL_DENIED` where the artifact channel isn't allowed. Every submission records its channel (D40).
- **Activation.** After a trusted control's change commits, a registered `trustedControls.activated` is told, best effort and never retried, like draft mirrors (D105).

### D109. Field coverage and orphans (delegated, M19)
Fills D42 and DATA_MODEL §3, which left open how Mostra knows which fields a version has:
- **Coverage is static.** The builder records in `registry.json` every field ID the version's code can use: literal IDs of `useField`, `useChoice` (`review.<set>.choice`) and the form adapter; template IDs as patterns; `storage.*` where the code uses `window.storage`. A field ID the scan can't know (a computed one, or one an MDX page or a package passes) makes the version *open*: it covers every ID, so nothing is ever orphaned by a guess. A version built before WP-07 has no `fields` and is open too. WP-18 and WP-20 extend the scan to kit inputs and review sets.
- **Orphans are derived, never stored.** A draft field is an orphan of a view when the view's version doesn't cover it. A submission computes its `orphaned` section in the submit transaction against the submitting view's version; the banner counts orphans against the newer version; the "Not carried over" panel lists them against the view's own. Nothing moves or is dropped: the field stays in the draft, a version that covers it shows it again, and every orphan is delivered (D42).
- **`fromVersion`.** Migration 6 renames DATA_MODEL's unused `field.orphaned_from_version` to `field.version_number`: the number of the version whose view last wrote the field, which is an orphan's `fromVersion`.
- **No fields declared.** A version whose code uses none of these (it writes the browser protocol itself, or keeps no fields) is open too: found while building, when such a version orphaned every answer it saved.

### D110. A submission contains what the viewer saw (delegated, M19)
`useField(id, initial)` stores nothing until the value changes, as `useState` would. Before any submit, through either channel, the client runtime writes the initial value of every mounted viewer field the draft has never stored, then flushes every pending save. A submission therefore holds the defaults the viewer saw and accepted, and the shell's required-field check, which reads the server's draft, agrees with the page. Fields that aren't mounted (another page, a closed section) were never seen and stay out.

### D111. WP-07's check boundaries (delegated, M19)
Each split leaves the later package free and gives it a baseline, as D93, D96 and D101 required:
- **Delivery targets (AU-09).** The client runtime takes its target from a `<meta name="mostra-target">` the exporters write (`static`, `mcp-app` or `verify`; none means `live`), and with it the history mode: browser, hash or memory. WP-07 proves each mode against a real version's client build served with that marker. WP-13's static export and WP-17's MCP App exporter write the marker and repeat the check; WP-09's `verify` sets `verify`.
- **Browser-protocol revisions (VR-10).** The first revision, `2026-10-15`, grows additively in WP-07. Every revision the gateway serves has a frozen fixture version in the repository, built at that revision and run in CI against the current gateway and against one that also serves a newer, test-only revision. A real N+1 adds its own fixture.
- **Shell wording.** The viewer-facing words (delivery states, banner, panel) are shown to Mirza with the candidate (IN-13). WP-20's design pass may restyle the shell, never weaken its trusted controls.
- **Prose** is delegated as in WP-03 to WP-06: Mirza sees only the texts the agent isn't confident in, before the merge.

### D112. `window.storage` compatibility details (delegated, M19)
D53's `window.storage` follows the API Claude-written artifacts use (`get`, `set`, `delete` and `list`, each with `shared`, answering `{ key, value, shared }`) over Mostra fields. Anthropic's help center documents personal and shared storage and a 20 MB limit per artifact, but not the signatures (VERIFIED_FACTS, WP-07), so Mostra's choices are stated here. A missing key resolves `null`, which code written to expect a thrown error or `null` handles alike. A value is limited to DATA_MODEL's 1 MiB per field, refused with `MOSTRA_FIELD_TOO_LARGE`, never truncated; a larger value belongs in a blob. Writes are last-write-wins, as in Claude: a conflict on a storage key is resolved by writing again on the newer revision.

### D113. `useChoice` names its candidates (delegated, M19)
`useChoice(reviewSetId, options?)` takes an optional `{ candidates: { id, label? }[]; current?: string }`, an additive extension of INTERFACES §2.3. With candidates it asks the shell for the trusted Choose control of that review set, which the shell renders outside the frame ("Choose Airy"). WP-20's `ReviewSet` passes them.

### D114. Claude reviews for up to ten packages (M19)
Amends D80 item 3: Claude Opus 5.5 may review up to ten of Mostra's packages, still chosen for substance and still waiting for Mirza's approval of each run (D34).

### D115. A frame always shows its own view's version (delegated, M19)
D98 item 5 lets an artifact origin serve the version its frame session last entered, so a tab whose frame reloads after another tab switched versions gets the other version's page. WP-07 makes that page unable to act as the wrong view, rather than only telling the viewer:
- **The page names its build.** The builder writes `<meta name="mostra-version" content="<versionId>">` into every version's `index.html` (the version ID is known from the digests before the build, D89, so builds stay a function of their inputs), and the client runtime sends it in `ui/initialize` (`mostra.versionId`, an additive parameter).
- **A mismatch saves nothing.** A page whose build isn't its view's version runs detached: nothing it shows is saved, journaled or submitted as that view.
- **The shell enters its version again.** The shell answers, then gets a ticket for its own view's version, so the frame reloads at that version. More than three re-entries within ten seconds mean two tabs keep moving the frame session, and the shell says so instead of reloading without end.

The version banner is unchanged: it tells a view about versions newer than its own (VR-04).

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
