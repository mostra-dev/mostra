# Mostra product definition

**Status:** Seed for the SP-58-C03-A phase design. The product direction is approved ([DECISIONS.md](DECISIONS.md)). Details marked "open for C03-A" in [ARCHITECTURE.md](ARCHITECTURE.md) are settled during that design with Mirza.

## The problem

Coding agents increasingly need to show people things and get structured answers back: prototypes to choose between, plans to approve, dashboards to read, questionnaires to fill in, end-of-work presentations, demos of terminal programs. Today each agent rebuilds a throwaway web page, a form store, a server and some CSS for every task, or falls back to walls of chat text. Answers vanish when a tab closes. An agent cannot see what it built. Nothing it builds runs in another harness.

Existing products each solve part of this (research [INDEX](../research/INDEX.md)):
- **Claude Artifacts** gives persistence but is cloud-hosted and closed.
- **MCP Apps** gives portable inline UI in chat hosts, but no storage, submissions or review model.
- **Streamlit, marimo and Gradio** are Python-first.
- **A2UI and json-render** constrain agents to declarative catalogs.
- **v0, Lovable, Bolt and Replit** build whole hosted applications.

None of them combines ordinary React authoring, durable human input owned by the host, agent-written actions, review of several candidates, exact terminal demos, verification for agents who can't see the browser, and embedding in any harness.

## The end state

An agent writes ordinary React. Mostra turns it into a beautiful, stateful, interactive web artifact on the user's machine, or inline in a chat host, or on a static page. The human looks, plays with it, answers, compares, comments and presses buttons that do real things. The answers flow back to the agent through whatever host it runs in, and survive restarts and timeouts. The agent checks its own work through `verify` before anyone sees it. Anyone can extend the kit, and the result is good enough that people show it to each other.

## Who uses Mostra

| Actor | What they do | How they reach Mostra |
|---|---|---|
| **Agent author** | Writes artifacts, verifies them, publishes, waits for and reads results | CLI and Skill when it has a filesystem; MCP server (local in v1, remote in v1.x); SDK when embedded |
| **Human viewer** | Views, interacts, drafts, comments, chooses, submits, presses action buttons | A normal browser on the same machine, a phone over the user's tunnel, inline in a chat host, or a static page |
| **Host** | Embeds Mostra and owns what it needs: the home's location, receipt and storage of delivered answers, identity, delivery to its agent, trusted controls (Mostra's ledger stays canonical, D58) | Host protocol and ports; the Rust host crate; the TypeScript SDK |
| **Plugin author** | Adds components, templates, engines, adapters, exporters, checks, connectors and commands | Extension contracts, manifests and source packs |

Known hosts and use cases (D11):
- **Jcode** (Mirza's Rust coding-agent harness). It spawns Mostra, owns durable answers and wakes its agent on submit ([JCODE_HOST.md](JCODE_HOST.md)).
- **Codex, Claude Code and other coding agents** use the CLI and MCP.
- **Chat products** such as ChatGPT and Claude.ai show inline MCP Apps in v1. Agents without a filesystem author through remote mode in v1.x.
- **Personal AI applications** host Mostra to show things like an inbox dashboard with real "Send" buttons.

## Vocabulary

Use these words consistently in code, docs, errors and the Skill. One word per concept.

| Term | Meaning |
|---|---|
| **Artifact** | One agent-authored interactive web document: source files, assets, data and optional server code. It has a stable artifact ID. |
| **Version** | One immutable, content-addressed published build of an artifact. Humans only ever see versions (D09). |
| **Publish** | The atomic step that freezes source and dependencies into a new version. |
| **View** | One human's opening of one version in one browser context. Submissions name their view. |
| **Draft** | The server-authoritative, revisioned accumulation of a viewer's input on an artifact: answers, interactive state, choices and comments. |
| **Submission** | An immutable snapshot of a draft that the server creates on Submit. It is bound to the version and view (D22). |
| **Epoch** | Under the `epochs` submission policy, one round of draft plus submission. Each epoch's submission is immutable and linked to the previous one. |
| **Event** | One append-only, durable record of a change (draft changed, submission created, comment added, action finished, data updated and so on). |
| **Signal** | An event the artifact or human raises on purpose for the host's attention. Submit is the standard signal. Authors may define others. |
| **Action** | An agent-authored server function invoked from the page. Each invocation is an **action run**. |
| **Review set** | A set of candidates (versions or surfaces within an artifact) presented as a gallery, compare view or choice. |
| **Comment** | A review thread pinned to an anchor on any content. |
| **Anchor** | A multi-resolution pointer to a place in content: semantic ID, selectors, coordinates and a screenshot crop. |
| **Shell** | The trusted outer page on its own origin. It hosts the review overlay, version banner, trusted controls and the artifact iframe. |
| **Trusted controls** | Submit, approve, choose and similar buttons rendered by the shell or host, outside agent code (D06). |
| **Capability URL** | The token-bearing link that grants use of an artifact. Holding it is the authorization (D06). |
| **Host** | The program embedding Mostra. The standalone CLI is a host too, with built-in adapters. |
| **Port** | One optional, typed interface a host implements: identity, submissions, drafts, reviews, events, addressing, trusted controls, capture, secrets, PTY, and a sandbox in v1.x (D58). |
| **Render mode** | How an artifact is built and served: `spa` in v1, `rsc` later (D19). |
| **Pack** | A copy-source bundle of components, templates, themes or starters. |
| **Plugin** | An npm package implementing one or more extension contracts. |
| **Kit** | Mostra's default components, design system and helpers. |
| **Field** | One persisted value with an explicit, stable ID (D52). Viewer-scoped fields make up a draft; artifact-scoped fields make up the artifact state. |
| **Artifact state** | The artifact-scoped fields that every viewer sees and that agents and hosts also write (D63). |
| **Live source** | A server-side producer or push target whose latest value pages read with `useLive` (D56). |
| **Follow** | A viewer's per-artifact choice to load new versions automatically (D63). |
| **Home** | The directory holding one Mostra installation's ledger, versions, sources, secrets and caches (D45). |
| **Instance** | The supervisor and its child processes that own one home (D45). |
| **Frame session** | How an artifact frame authenticates: cookie mode where shell and artifact are same-site, worker mode where they are cross-site (D38, D70). |
| **Ledger** | The home's transactional store, written only by the supervisor (D58, D71). |

## Journeys

These are the caller-first scenarios that the design and acceptance must serve. The command and API names are illustrative until C03-A fixes them.

**J1. Prototype review in a coding session.** An agent working on a sidebar redesign scaffolds an artifact with three candidate implementations as a review set. It runs `mostra verify` until the verdict is `pass`, publishes, and shares the capability URL. Its host (for example Jcode) records a wait on the artifact. Mirza opens the link, flips between candidates side by side, picks the second, pins two comments on its header and one on a terminal frame, and presses the shell's Submit. The host receives one submission containing the choice, the comments with screenshot crops and the version IDs, and wakes the agent. The agent reads full results through `mostra results`.

**J2. Live operations dashboard.** An agent builds a dashboard whose loader polls an API and whose stream pushes updates through SSE. A high-rate chart uses uPlot. The human leaves it open all afternoon. Data updates without any code change. Later the agent publishes v2 with a new panel. The open page shows a "new version available" banner and switches only when the human clicks.

**J3. Inbox with real actions.** A personal AI application hosts Mostra. Each morning its agent publishes an inbox artifact. Every email has an expandable, editable pre-drafted reply and a "Send" button wired to an agent-authored action that calls the user's mail API with a secret held server-side. The human edits a reply and presses Send. The action run streams progress. Its idempotency key stops a double click from sending twice. Another website the user visits cannot press that button, because it doesn't hold the capability URL.

**J4. Terminal UI prototypes.** For a TUI redesign, an agent builds ratatui candidates. It captures them cell-exact through the TestBackend capture crate. It also shows the real binary live in a PTY next to the captures. It verifies the layout with `mostra term dump --format text` before publishing. The human compares candidates with synchronized playback and pins comments to cell regions.

**J5. End-of-work presentation.** An agent writes an MDX deck with motion compositions, a chart, a code diff and an embedded live demo of the feature it built (the project's own dev server proxied into an iframe). It asks for approval with a trusted Approve control.

**J6. Multi-round questionnaire.** Round one is an artifact with structured questions and free-text notes. After submission, the agent publishes round two as a new artifact linked to the first, under the `once` policy. A host using `epochs` would instead open a new epoch on the same artifact.

**J7. Inline in a chat host.** A Claude or ChatGPT user's agent calls Mostra's MCP server. The same artifact source renders inline as an MCP App, with a plain URL fallback for the full page.

**J8. Review from a phone.** The user exposes Mostra through Tailscale Serve. Mostra maps the tailnet identity headers to a viewer identity, and the user answers from their phone.

**J9. Agent installs a plugin.** An agent needs video-style compositions beyond the built-in primitive. It searches the plugin index, inspects the Remotion adapter, and sees its license class. It installs it with `--accept-license LicenseRef-Remotion`, which is recorded in the lockfile, and runs the plugin's verify baselines.

**J10. Remote authoring (v1.x).** A ChatGPT Business user's agent connects to a self-hosted Mostra remote server. It creates an artifact and pushes files and patches, each against a `base_rev`. It runs a server-side build and verify job and gets compact diagnostics and screenshots. It publishes and returns the URL.

**J11. Personal dashboard, all week (D63).** A personal AI application publishes a dashboard with submission policy `none`, on a home whose daemon runs as a login service. Live sources refresh calendar, mail and finance data. The agent updates artifact state ("today's priorities") through `mostra state set` and publishes new versions as it learns what the user wants. The user follows the artifact, so new versions load automatically when nothing is unsaved. The user ticks off priorities and presses actions all day. The host wakes the agent only for the `state.changed` events it filters for. After a month the home is still bounded and fast.

**J12. Team task manager (D63).** An AI task-manager application hosts Mostra for a small team over the tailnet. Tasks are artifact-scoped state: teammates and the agent create, edit and complete them, and each change is attributed to its viewer identity. Two people editing the same task get an explicit conflict, never a silent overwrite. The agent reacts to new tasks through the host's event filter and posts its own updates as state changes.

## Scope

Release scope is decided in D16 and refined into requirements in [REQUIREMENTS.md](REQUIREMENTS.md). Summary:
- **v1, complete local-first product:**
  - runtime, versions and publishing, the remote-viewing ladder and static export;
  - the interaction model;
  - actions and live data;
  - the review layer;
  - the full kit with motion and decks;
  - terminal and web demos;
  - the CLI, Skill, `verify`, `wait` and `results`;
  - the local MCP server and MCP Apps export;
  - the SDK, host protocol, Rust crate and conformance kit;
  - plugin contracts at 0.x with first-party plugins.
- **v1.x:** remote mode, the read-only plugin registry with agent tools, RSC render mode once triggered, Yjs collaboration, and PDF and video exporters.
- **Later:** the managed cloud service and the marketplace web interface.

**Platforms.** macOS and Linux are required for v1. Recent Chrome, Firefox and Safari are supported viewers (all through port-per-artifact origins, D38). Mobile Safari and Chrome are supported viewers over the remote ladder. v1.0 explicitly does not support Windows; it stays on the roadmap for a later release (D35).

## Non-goals

- **Content or capability guardrails** of any kind (D05).
- **A general AI app builder, cloud IDE or hosting platform for arbitrary applications.** Mostra hosts artifacts. Projects keep their own apps, which Mostra can proxy as demos.
- **A chat frontend or agent framework.** Mostra is a runtime that agents and hosts call.
- **A declarative UI protocol or schema** that agents must fill in (D04).
- **Multi-user real-time co-editing by default.** It is available as a Yjs plugin in v1.x.
- **A managed public hosting service in v1** (D12).
- **Final Jcode integration.** That is C03-B, and Mostra serves it through generic ports only (D01).

## Rule strengths

Labels follow [STANDARDS.md](STANDARDS.md#rule-strengths).

**Invariants** (changing one needs Mirza's explicit approval):
1. Mostra adds no content or capability guardrails (D05).
2. Only capability-URL holders can use an artifact. Loopback is the default bind (D06).
3. Published versions are immutable. Humans only see published versions (D09).
4. Submissions are immutable, created from the server's canonical draft, and name the exact version and view (D22).
5. Drafts are never delivered as submissions.
6. Submissions are durable before any delivery attempt. A wait timeout, a host outage or a closed tab never loses one (D11).
7. Trusted controls never render in an origin that agent code controls (D06, D21).
8. Non-OSI engines are never bundled. Their licenses are disclosed before install (D26, D31).
9. Everything users install, embed or self-host is Apache-2.0 (D14).
10. Interfaces evolve additively within a version (D32).
11. Hosts reach Mostra only through public ports and protocol. No host-specific code lives in Mostra's core (D01).

**Requirements:** numbered in [REQUIREMENTS.md](REQUIREMENTS.md).

**Defaults** (C03-A may deviate with evidence and a recorded reason): the kit list (D26), the Node LTS line (D18), origin-per-artifact addressing with port fallback (D21), the tooling baseline in [STANDARDS.md](STANDARDS.md#tooling-baseline).

**Guidance:** the launch gallery ideas and pricing sketches in the research reports.

## Quality and adoption

"Beautiful by default" belongs to the kit and its tokens, not to each agent's effort. Adoption depends on things that research brief 1 found in tools that spread (Streamlit, shadcn/ui, Vite):
- one-command start;
- inspectable source that agents can edit;
- documentation written for agents as a primary audience;
- a gallery that shows the prompt, the source and the result side by side;
- a strong, legible category noun ("the agent artifact runtime").

**Launch demos** should be things no competitor can easily copy:
- the inbox with a working Send button;
- a multi-candidate design review whose comments flow back to the agent;
- a pixel-exact TUI demo next to explanatory UI;
- a live dashboard;
- a deck with embedded live demos;
- the same artifact open locally and inline in Claude or ChatGPT.

The documentation site is built with Mostra itself.
