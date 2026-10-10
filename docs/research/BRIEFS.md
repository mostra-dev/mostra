# Research briefs (provenance)

These are the exact prompts Mirza ran on external deep-research agents between 2026-10-09 and 2026-10-10. Each run received the shared context followed by one brief. Briefs 7 and 8 also received the update line shown after the shared context. The reports they produced are indexed in [INDEX.md](INDEX.md).

The prompts use the placeholder name "the toolkit". The project was named Mostra afterwards (decision D19 in [../DECISIONS.md](../DECISIONS.md)).

## Shared context

```text
## Shared context (prepend to every brief)

We are designing an open-source, standalone toolkit that lets AI agents create rich, interactive, browser-based "artifacts" for humans: dashboards and data visualizations, motion graphics/animations, live demos (web apps in any framework, and terminal/TUI apps rendered with exact fidelity), presentations/slide decks, questionnaires and forms whose inputs persist server-side, review surfaces (browse several candidates, choose one, comment on it), live data views (local or online APIs, updating as data changes), and pages with real actions authored by the agent (e.g., an inbox dashboard where the user edits an AI-drafted reply and presses a "Send" button whose behavior the agent implemented).

Commitments already made:
- React-based. Agents write ordinary React/TypeScript (possibly MDX). No custom DSL, no rigid schema, no closed component whitelist.
- Maximum capability. The toolkit adds no content/capability guardrails; what an artifact does is the responsibility of the agent/application using it (as curl does not police URLs). Hygiene that stops third parties (e.g., other websites) from invoking a user's local artifact is in scope.
- Host-agnostic. Works standalone (CLI) and embeddable by other agent harnesses and apps. One known host is a Rust coding-agent harness that will spawn the toolkit, own durable answer storage, and deliver submissions back to the agent. Expect pluggable host ports (storage, events, identity, addressing, host-rendered trusted controls).
- Local-first: user's own machine (macOS first, Linux too), normal desktop browser, possibly remote from a phone over the user's own tunnel/VPN.
- Primary authors are LLM coding agents that run commands and edit files but cannot see the browser unless given screenshots.
- Goal: enterprise-grade engineering, beautiful by default, good enough to be widely adopted.

Research standard: The date is October 2026. Verify against current primary sources (official docs, repos, release notes, license files, specs); knowledge in this area goes stale fast. Give versions, dates, licenses (including commercial restrictions), maintenance signals and links. Separate verified facts from judgment. For competing options give a comparison table and a ranked recommendation with reasons and what would overturn it. Depth on decisive questions beats shallow breadth.
```

Update line added for briefs 7 and 8:

```text
Update: remote hosting and remote authoring (agents without filesystem access, e.g. ChatGPT web/mobile) are now in scope, as is a plugin/marketplace ecosystem.
```

## Brief 1: Landscape, prior art and positioning

```text
Survey everything that overlaps with this toolkit and determine where it should sit.
1. Agent-generated UI and artifacts: Claude Artifacts (incl. persistent storage and AI-in-artifact features), ChatGPT Canvas, v0, Bolt/StackBlitz, Lovable, Replit, Val Town, Vercel AI SDK generative UI, CopilotKit / AG-UI, assistant-ui, MCP-UI and the MCP Apps extension, OpenAI Apps SDK, Google A2UI, and anything newer. For each: architecture, rendering/sandbox model, state and persistence, how user input flows back to the agent, extensibility, licensing, adoption.
2. Data-app and document tools: Streamlit, Gradio, Marimo, Observable Framework, Evidence, Shiny/Panel, Quarto, Slidev, Spectacle, MDX-based doc tools. What do they get right about authoring speed, state and interactivity, and where do they fail for agent authors?
3. Gaps: what can none of them do that an agent-first, React-based, host-embeddable toolkit with server-side inputs, real actions, faithful TUI demos and a review/comment layer could do?
4. Interop opportunities: should the toolkit render inside MCP Apps / Apps SDK hosts, expose an MCP server, or interoperate with A2UI/AG-UI? Concrete integration shapes and costs.
5. Adoption: what made comparable developer tools spread (Streamlit, shadcn/ui, Vite, Remotion, tldraw, Excalidraw)? Lessons on naming, docs, galleries, licensing, community and "wow" demos.
Deliverable: a landscape table, a gap analysis, a positioning recommendation and a list of design ideas worth borrowing, each with its source.
```

## Brief 2: Runtime and architecture

```text
Recommend the runtime architecture.
1. Server/rendering model: React 19 Server Components and Server Functions (via Next.js, Waku, React Router RSC, Parcel RSC or others) vs. Vite + React SPA + a small typed RPC server (Hono, tRPC-like) vs. TanStack Start vs. others. Criteria: agent authoring simplicity, zero-config per artifact, HMR, server actions/loaders/streaming, startup time, stability and lock-in.
2. JS runtime and distribution: Node vs. Bun vs. Deno; single-binary compilation (bun build --compile, deno compile, Node SEA); how a non-JS host (a Rust program) best spawns and talks to it (sidecar over HTTP/stdio/JSON-RPC vs. embedding a JS engine). Cold start, memory, Windows/Linux/macOS support.
3. Dependencies without per-artifact npm install: preinstalled curated bundle, import maps / esm.sh, on-demand install with a shared cache, lockfile reproducibility, offline use, and allowing arbitrary npm packages.
4. Many artifacts at once: one server hosting many artifacts vs. a process per artifact; isolation between artifacts (origins/ports), routing, resource use, crash containment.
5. Versioning: content-addressed builds, "live preview" (HMR while the agent edits) vs. "published/frozen" versions, static export of a frozen version for sharing or archiving, and binding user submissions to the exact version shown.
6. Embedding foreign apps: proxying an agent's own dev server (any framework) into an iframe (WebSocket/HMR passthrough, path vs. port vs. subdomain routing) vs. in-browser bundling (Sandpack, esbuild-wasm, WebContainers: licensing!).
Deliverable: two or three candidate architectures with diagrams, a comparison and a ranked recommendation, including a package/module decomposition for a monorepo.
```

## Brief 3: Components, visualization and motion

```text
Choose the default kit. A decisive criterion is how fluently current LLMs write code for each library (training-data prevalence, API stability), beyond quality, bundle size, accessibility, theming, license and maintenance.
1. UI foundation: shadcn/ui, Radix, Base UI, React Aria, Ark UI, Mantine, Tailwind v4; theming, dark mode and "beautiful by default" typography.
2. Charts: Recharts, Visx, Nivo, ECharts, Plotly, Vega-Lite, Observable Plot, uPlot (high-rate live data), Tremor, shadcn charts. Static, interactive and streaming use.
3. Tables/grids (TanStack Table, AG Grid licensing), forms/validation (react-hook-form, TanStack Form, Zod), diagrams (Mermaid, React Flow/xyflow, Excalidraw, tldraw licensing), maps (MapLibre, deck.gl), 3D (react-three-fiber), code (Shiki, CodeMirror, Monaco), math (KaTeX).
4. Motion: Motion (ex-Framer Motion), GSAP (current license after the Webflow change), Remotion (license terms for companies, Player embedding), Motion Canvas, Revideo, Theatre.js, Lottie/dotLottie, Rive. Which give programmatic, embeddable, interactive motion graphics that agents can author well, and which licenses fit an MIT/Apache open-source toolkit?
5. Presentations/slides in React/MDX: Slidev concepts, Spectacle, reveal.js integration, MDX deck patterns.
Deliverable: a recommended default set per category with alternatives, a license-risk table, and the decisive tradeoffs.
```

## Brief 4: Faithful TUI demos and arbitrary web demos

```text
The toolkit must show terminal UIs exactly as they look in a real terminal. An agent should be able to build a TUI (e.g., Rust ratatui, also Go Bubble Tea, Python Textual, Node Ink) and render it in the page, live or recorded.
1. ratatui to web: Ratzilla, webatui, other WASM backends; maturity, fidelity, input handling, limits (crossterm/termion dependencies, async, file/network access).
2. Live terminals: real process in a PTY streamed to xterm.js (ttyd, gotty, wetty patterns, node-pty vs. Rust/Go PTY bridges), resizing, true color, Unicode width/emoji/box drawing, fonts and ligatures, latency, multiple concurrent sessions.
3. Recorded and static: asciinema v3 cast format and player, VHS, terminal frame sequences, and serializing a ratatui TestBackend buffer (cells, styles) into a cell-exact React renderer; animation from frame sequences; pixel-faithful fonts.
4. Annotating terminal content: pinning comments to cells or regions, comparing several TUI candidates side by side.
5. Web demos of any framework embedded as real working pages: iframe isolation, device-frame/viewport switching, screenshots, HMR passthrough.
Deliverable: a recommended architecture covering live, WASM and recorded modes behind one component family, with fidelity limits stated honestly and a prototype plan.
```

## Brief 5: Interaction, state, review layer and local-server hygiene

```text
1. Server-persisted inputs: autosaved drafts, multi-tab sync (SSE/WebSocket, optimistic concurrency, CRDTs such as Yjs/Automerge: needed or overkill?), offline drafts, and a single immutable "submission" snapshot bound to the content version shown. Prior art: Claude artifact storage, Streamlit session state, Liveblocks, Convex, PartyKit, ElectricSQL, Replicache/Zero.
2. Review layer: pinned comments and annotations on arbitrary content including cross-origin iframes and canvas/terminal content (prior art: Vercel toolbar comments, Liveblocks comments, Figma, Marker.io, BugHerd, tldraw), candidate galleries, choose-one, side-by-side compare, screenshot-anchored feedback. How to make it work universally?
3. Real actions: agent-authored server functions invoked from buttons, streaming progress and results, emitting events to a host (e.g., "notify the agent"), long-running actions, idempotency and retries.
4. Live data: loaders, polling, SSE/WebSocket streams, file watching, pushing data into a running artifact from a CLI/SDK.
5. Host integration: a clean port/adapter design so a host can own storage of drafts/submissions, receive events, supply identity and addressing, and render its own trusted submit/approve controls outside agent-authored content. Prior art from MCP elicitation, MCP Apps postMessage protocols, Jupyter kernels/servers, VS Code webviews.
6. Hygiene without capability limits: how Jupyter and similar local servers prevent other websites from invoking them (tokens, Host/Origin checks, DNS-rebinding defenses, CSRF, cookie scoping), safe remote access over a user's own tunnel, and what minimum is needed so an agent's "Send" button can only be pressed by someone holding the artifact URL. Do NOT propose content restrictions on what artifacts or agents may do.
Deliverable: a state and event model, a review-layer architecture, a host-port interface sketch and a minimal hygiene checklist with sources.
```

## Brief 6: Agent ergonomics, verification and project engineering

```text
1. Making agents produce excellent artifacts: documentation designed for LLMs (llms.txt, agent skills such as Anthropic Agent Skills, example galleries, templates), API designs that LLMs get right the first time, error messages written for agents, and what current evidence says about generated-UI quality.
2. Closed feedback loop for agents that cannot see the browser: headless rendering (Playwright and alternatives), compile/runtime/console error capture, multi-viewport screenshots for multimodal models, accessibility checks, synthetic interaction smoke tests; cost and latency.
3. Distribution surfaces: CLI design, MCP server design (tools vs. resources, MCP Apps), TypeScript SDK, a language-neutral host protocol (JSON Schema/OpenAPI) and a Rust client, Claude Code/Codex/other-harness plugins.
4. Open-source engineering: monorepo tooling (pnpm, Turborepo/Nx, changesets), strict TypeScript, testing (Vitest, Playwright, visual regression), API stability and semver for a protocol plus libraries, host conformance test kits, docs site built with the toolkit itself, security policy, license choice (MIT vs. Apache-2.0) and governance for a project that hopes to grow quickly.
Deliverable: a concrete agent-ergonomics design, a verification-loop design, a distribution plan and an engineering blueprint for the repository.
```

## Brief 7: Remote authoring, hosted service and business model

```text
1. How do remote agents (ChatGPT web/mobile, Claude.ai/mobile, Gemini, others) connect to custom remote MCP servers today: transports, OAuth 2.1/CIMD auth flows, plan/feature gating, mobile support, and how MCP Apps render there? Primary docs only.
2. Remote authoring design: an MCP tool surface for agents without a filesystem to create and edit multi-file artifacts (file push vs patch vs bundle upload), server-side build and headless verification, size/latency limits.
3. Multi-tenant execution of agent-authored server code: compare Firecracker-based (Fly Machines, E2B, Vercel Sandbox), gVisor (Modal, Cloud Run), Cloudflare Workers/Containers, Daytona and others on cold start, isolation, network egress, persistent storage, pricing and licensing. Isolation here protects tenants from each other, not users from their own artifacts.
4. Hosting artifacts at scale: wildcard per-artifact origins, TLS, viewer authentication (magic links, OAuth, share tokens), storage of versions and submissions, abuse and phishing handling on a public multi-tenant domain (prior art: CodeSandbox, StackBlitz, Val Town, Vercel previews, Glitch).
5. Self-host vs managed: what a single-VPS self-host mode needs; one codebase for both.
6. Open-core economics: how permissive-core projects monetize hosting (Vercel/Next.js, Supabase, Streamlit Cloud, Gradio/HF Spaces, Val Town, PartyKit), license implications of Apache-2.0 vs FSL/BSL/ELv2 for a project that wants viral adoption plus a hosted business.
Deliverable: a remote-mode architecture, a sandbox recommendation table, an MCP tool surface sketch, and a business/license recommendation.
```

## Brief 8: Extension system and marketplace

```text
1. Prior art for extension systems and marketplaces: shadcn registry (copy-source distribution), VS Code extensions, Vite/Rollup plugins, Storybook addons, Raycast Store, Obsidian community plugins, Grafana plugins, Backstage, Herdr plugins (herdr.dev/plugins), the MCP Registry and Agent Skills directories. For each: extension-point model, manifest format, versioning and compatibility, discovery, review/verification, trust signals (provenance, verified publishers), monetization, and what made the ecosystem grow or stall.
2. Extension points for our toolkit: component/template packs, embed engines (terminal engines, foreign-app adapters, Remotion/GSAP adapters), host adapters (storage/identity/addressing), review anchor providers, verify checks, export targets (MCP App, PDF, video), data connectors, CLI commands. Recommend a contract style per point (typed interfaces, manifests, lifecycle hooks) and how to version them independently of the core.
3. Agent-discoverable ecosystem: how an agent should search, evaluate, install and use plugins autonomously (registry API, MCP tools, skills bundled in plugins), and how examples and verification baselines prove a plugin works.
4. Trust without capability restrictions: provenance (npm trusted publishing/Sigstore), compatibility test badges, license metadata surfaced at install time (critical for non-OSI engines like Remotion/GSAP), deprecation and takeover policies.
Deliverable: an extension architecture, a manifest schema sketch, a registry design, and a phased marketplace plan (registry first, UI later).
```
