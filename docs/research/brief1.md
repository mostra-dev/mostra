# Agent Artifact Toolkit: Landscape, Gaps and Positioning (October 2026)

**Bottom line: build a local-first, MIT/Apache-licensed "artifact runtime" that renders ordinary React as full-page apps on the user's machine, with server-side inputs, real actions and a review/comment layer. Make MCP Apps (SEP-1865, stable 2026-01-26) its first-class export and embed format, and an MCP server its primary agent interface. Do not compete with MCP Apps. Treat it as the packaging and transport standard that the toolkit compiles to.** As of October 2026, every chat host that matters (Claude, ChatGPT, VS Code, Goose, Postman, Vercel AI SDK 7) has converged on MCP Apps for embedded UI. Nobody yet owns the local, durable, review-oriented, agent-authored React workspace that sits outside the chat window.

## TL;DR

- **The standards war for embedded agent UI is over, and MCP Apps won.** SEP-1865 has been "Stable (2026-01-26)" since January.\[1\] OpenAI's changelog records that "ChatGPT is now fully compatible with the MCP Apps spec" (2026-02-22), and `window.openai` survives only as a compatibility alias plus ChatGPT-only extensions.\[2\]\[3\] Google's A2UI (v0.9.1 current, v1.0 candidate) and Vercel's json-render (Apache-2.0) take the opposite bet: declarative JSON constrained to a component catalog.\[4\] That bet conflicts with this toolkit's "ordinary React, no whitelist" commitment. Interoperate with them; don't adopt them as the authoring model.
- **The gap is real and specific.** Claude Artifacts gives persistence (20 MB, text only, published artifacts only, Pro/Max/Team/Enterprise on web and desktop, per the Claude Help Center) and live data, but it is cloud-hosted, closed, and has no host ports. MCP Apps views are ephemeral, chat-sized iframes with no storage, submissions or review model. The data-app tools (Streamlit, marimo, Evidence, Observable, Slidev) are Python- or Markdown-first, or single-purpose. None combines React authoring with server-side durable inputs, agent-implemented actions, candidate review and comments, pixel-exact TUI demos, headless verification for blind agents, and pluggable host storage and identity. The closest prior art is small and early: Postplan (v1.2.0, Oct 6 2026) and plannotator's Artifact Server.
- **Recommended interop, ranked:** (1) ship an MCP server (create/update/list/read-submissions/wait-for-feedback) alongside the CLI; (2) compile any artifact to a single-file `ui://` MCP Apps resource, with a host-bridge shim so the same React runs standalone and inside Claude, ChatGPT and VS Code; (3) a thin AG-UI event adapter; (4) an optional A2UI renderer component. What would overturn this: MCP Apps adding first-class persistent state and submissions (shrinking the gap), or a major host rejecting full-page local URLs (raising the value of embed-only).

## Key Findings

### Verified facts vs. judgment

Statements attributed to a spec, changelog, docs page, repo or release are **verified** against sources gathered in this research pass (October 2026). Statements marked *(judgment)* are my assessment. Statements marked *(unverified)* come from secondary sources or memory and should be re-checked before relying on them.

### 1. Landscape table — agent-generated UI and artifacts

| Tool | Version / status (Oct 2026) | License | Rendering / sandbox model | State & persistence | How user input returns to the agent | Primary source |
|---|---|---|---|---|---|---|
| **MCP Apps (SEP-1865)** | Spec "Stable (2026-01-26)"; draft continues; the ext-apps repo has 2.8k stars, 375 forks and 666 commits (per its GitHub README, Oct 2026); `@modelcontextprotocol/ext-apps` SDK v1.7.5 (Jul 23 2026, per secondary source) | Apache-2.0 (license badge on the ext-apps README) | `ui://` resource, mime `text/html;profile=mcp-app`, HTML5 doc. Web hosts MUST use a sandbox proxy on a different origin with `allow-scripts allow-same-origin`. Declared CSP (`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`); restrictive default CSP; host "MUST NOT allow undeclared domains"\[1\] | None standardized; host context (theme, locale, display mode, container dimensions) only | JSON-RPC 2.0 over `postMessage`: `tools/call`, `resources/read`, `ui/message`, `ui/open-link`, `ui/notifications/tool-input` / `tool-result`; tool `visibility: ["model","app"]` enables app-only tools\[1\] | github.com/modelcontextprotocol/ext-apps |
| **OpenAI Apps SDK** | Active; "fully compatible with the MCP Apps spec" since 2026-02-22; May 2026 changes route approved tool input via `ui/notifications/tool-input`\[2\]\[5\] | Proprietary platform; SDK examples open | Same iframe model; sandbox origins like `*.oaiusercontent.com` | `window.openai.widgetState` / `setWidgetState` (ChatGPT-only extension)\[6\] | Standard `ui/*` bridge; aliases `window.openai.callTool`, `sendFollowUpMessage`, `toolInput`, `toolOutput`; extras `requestCheckout`, `uploadFile`, `selectFiles`, `requestModal`\[6\] | developers.openai.com/apps-sdk |
| **MCP-UI** | `@mcp-ui/client` 7.1.1, `@mcp-ui/server` 6.x; now positions `AppRenderer` for MCP Apps and `UIResourceRenderer` as legacy\[7\]\[8\] | Apache-2.0 | Sandboxed iframes; historically HTML, external URL and Remote DOM content types\[9\] | None | Legacy `onUIAction` (tool, prompt, link, notify, intent); now MCP Apps JSON-RPC\[10\] | mcpui.dev; github.com/MCP-UI-Org/mcp-ui |
| **Claude Artifacts** | Persistent storage + MCP added Oct 21 2025 (the update reads "Artifacts now support MCP and persistent storage."); Live Artifacts in Cowork Apr 20 2026 (reported legacy Aug 19 2026, *unverified*); Claude Code Artifacts beta Jun 18 2026 for Team/Enterprise | Proprietary | Sandboxed iframe on Anthropic origins (MCP Apps uses e.g. `{hash}.claudemcpcontent.com`) | `window.storage.get/set/delete/list(key, …, shared)`; 20 MB per artifact, text only, Pro/Max/Team/Enterprise on web and desktop. The Claude Help Center says "Persistent storage is only available for published artifacts. During development and testing, storage operations will not succeed until the artifact is published." Unpublishing deletes data | Artifacts can call Claude ("AI-in-artifact"); no channel back to the authoring agent's session except re-prompting\[11\] | Claude Help Center (support.claude.com), as quoted by caipi.ai; x.com/claudeai |
| **Vercel AI SDK** | AI SDK 7 GA Jun 25 2026 (adds MCP Apps, terminal UI, tool approvals, WorkflowAgent); `ai@7.0.114` Sep 24 2026\[12\]\[13\]\[14\] | Apache-2.0 *(unverified this pass)* | Generative UI = tool parts rendered as your own React components in your app\[15\] | Your app; WorkflowAgent for durable runs | Typed `message.parts` (`tool-{name}`, `output-available`); tool approval\[16\] | vercel.com/blog/ai-sdk-7 |
| **json-render (Vercel Labs)** | Launched Jan 2026; 18.4k stars and 977 forks (github.com/vercel-labs/json-render); ships "36 pre-built shadcn/ui components" and a `@json-render/mcp` package for "MCP Apps integration for Claude, ChatGPT, Cursor, VS Code"; updated Oct 7 2026 | Apache-2.0 | JSON spec constrained to a Zod-defined catalog; renderers for React, Vue, Svelte, Solid, RN, Ink (terminal)\[17\] | Expression-based data binding\[18\] | Catalog actions | github.com/vercel-labs/json-render |
| **Google A2UI** | v0.9 (Apr 17 2026), **v0.9.1 current**, v1.0 candidate (adds client-to-server `actionResponse`, action IDs)\[4\]\[19\] | Open spec (Google; *confirm LICENSE*) | Declarative JSON (`application/a2ui+json`), "not executable code"; renderers React, Flutter, Lit, Angular\[4\]\[20\] | Client-server data sync | Actions over any transport (A2A, AG-UI, MCP, WebSocket); "A2UI in MCP Apps" documented\[4\]\[19\] | google.github.io/A2UI |
| **AG-UI / CopilotKit** | AG-UI 1.0: 31 event types in 8 categories (runs/steps, text, tool calls, reasoning, state, activity, subagents, custom/raw); SSE default\[21\] | MIT *(unverified this pass)* | Protocol, not a renderer; CopilotKit supplies React components\[22\] | `STATE_SNAPSHOT` / `STATE_DELTA`\[23\] | Client POSTs `RunAgentInput`, receives event stream; frontend tool calls\[21\]\[22\] | docs.copilotkit.ai; copilotkit.ai/blog |
| **assistant-ui** | Very active (`@assistant-ui/react-mcp@0.1.17`, Sep 11 2026; `react-ag-ui` package); MCP App Studio starter\[24\]\[25\] | MIT *(unverified this pass)* | Chat UI primitives; MCP Apps workbench that shims `window.openai`\[25\] | App-defined | MCP Apps bridge, AG-UI | github.com/assistant-ui |
| **Postplan** | v1.2.0 (Oct 6 2026)\[26\] | Open source (check LICENSE) | Agent deploys self-contained pages to a live URL on self-hosted Cloudflare Workers\[27\] | Implements Claude-compatible `window.storage` (per-viewer private keys)\[28\] | Comments; "let agents wait for sent feedback"\[26\] | github.com/notsuhas/postplan |
| **plannotator Artifact Server** | Active 2026 | Open source (check LICENSE) | Self-hostable publish/review server\[29\] | Versioned artifacts, projects\[29\] | Built-in MCP server; comments; live feedback via Pi and Claude Code Channels (research preview)\[29\] | github.com/plannotator/artifact-server |
| **ChatGPT Canvas, v0, Bolt/StackBlitz, Lovable, Replit, Val Town** | Not re-verified this pass | Proprietary platforms (Bolt has an open-source `bolt.diy` fork, *unverified*) | Cloud-hosted editors/previews (StackBlitz WebContainers in-browser Node) | Platform DBs (e.g., Supabase-backed in Lovable/Bolt, *unverified*) | Chat re-prompting; no protocol back to an external agent | — |

**What the table means** *(judgment)*: the field has split into three camps:
- **Code-in-iframe protocols** (MCP Apps, Apps SDK, MCP-UI). They are portable but ephemeral and chat-sized.
- **Declarative catalogs** (A2UI, json-render). They are safe and streamable, but closed to arbitrary React.
- **Hosted app builders** (v0, Lovable, Bolt, Replit, Claude Artifacts). They are capable but cloud-locked and not embeddable as a library.

The toolkit's commitments (any React, maximum capability, local, host-pluggable) put it in a fourth, nearly empty quadrant.

### 2. MCP Apps details that decide the design (verified from the 2026-01-26 spec)

- **Two-origin sandbox:** the host and the sandbox "MUST have different origins". The sandbox proxy receives raw HTML via `ui/notifications/sandbox-resource-ready` and loads it with CSP built from declared domains, plus `object-src 'none'`.\[1\]
- **Default CSP when nothing is declared:** `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'none'`.\[1\] Artifact bundles must therefore be **single-file with inlined JS/CSS**, or declare every CDN and API origin.
- **App-only tools:** `visibility: ["app"]` tools are hidden from the model, but the view can call them.\[1\] This is exactly the mechanism for an agent-implemented "Send" button that should not be model-callable.
- **Theming contract:** about 80 standardized CSS variables (`--color-background-primary`, `--font-sans`, `--border-radius-md`, …) passed in `hostContext.styles`. Hosts should use `light-dark()`.\[1\]
- **Display modes and sizing:** `inline | fullscreen | pip`. With flexible dimensions, hosts MUST honor `ui/notifications/size-changed`.\[1\]
- **Optional permissions:** camera, microphone, geolocation and clipboard-write. Hosts MAY honor them.\[1\]
- **Known adoption:** the ext-apps README's "Supported Clients" section lists ChatGPT, Claude, VS Code, Goose, Postman, MCPJam, mcp-use and Alpic Playground, and VS Code's MCP Apps support post is dated 2026-01-26. ChatGPT reached full compatibility on Feb 22 2026,\[2\] and AI SDK 7 added MCP Apps in June 2026.\[12\]

### 3. Data-app and document tools

| Tool | Latest (Oct 2026) | License | What it gets right | Where it fails agent authors who can't see the browser |
|---|---|---|---|---|
| **Streamlit** | 1.65.0 (Oct 2 2026)\[30\] | Apache-2.0 *(unverified)* | Script-rerun model is the fastest authoring loop ever shipped. Custom Components v2 (since 1.51, Nov 2025) drop the iframe and separate *state* from *trigger* values.\[31\]\[32\]\[33\] Bundles agent skills (`streamlit skills`, 1.58)\[30\] | Python-only UI vocabulary; rerun model fights real actions and long-lived server state; React only via components |
| **Gradio** | 6.29.0 (Sep 29 2026)\[34\] | Apache-2.0 *(unverified)* | Every app is also an API; `gradio skills add`;\[35\] Hugging Face Spaces distribution | Built around ML demos; layout and visual polish ceiling |
| **marimo** | 0.24.x–0.25 (Sep 2026)\[36\] | Apache-2.0 | Reactive DAG with no hidden state; notebooks are pure `.py` files (git-diffable, runnable as scripts). **marimo pair** (Apr 2026) puts agents inside a live session.\[37\] Slides mode (Jul 2026); MDX embedding\[38\]\[39\]\[40\] | Python-first; UI is marimo widgets, not arbitrary React |
| **Observable Framework / Notebooks 2.0** | Framework v1.13.4 (Mar 2 2026), effectively maintenance mode, and the `deploy` command is deprecated.\[41\] Notebook Kit 2.x active; new Observable became default ~Sep 2026\[42\] | ISC (Framework)\[43\] | Data loaders (polyglot, cached, build-time); file-based; moved to **vanilla JavaScript** ("don't mess with language standards"). Notebook Kit 2.2.0 cut size from 1 MB to 71 kB\[44\]\[45\]\[46\] | Framework's momentum has moved to the hosted product; reactive runtime is non-React |
| **Evidence** | Evidence Core open-sourced Aug 2026; repo active again (updated Oct 8 2026)\[47\]\[48\] | MIT (Core); Studio is commercial, and its MCP server and agent are Studio-only\[48\]\[49\] | SQL + Markdown is ideal for LLMs; Core pitched as "the best framework for building data apps with coding agents"\[48\] | Reporting-only; no actions or forms; pivot history (OSS stalled early 2026) is a maintenance-risk signal |
| **Shiny for Python / Panel** | Shiny 1.7.0 (Jul 2026), 1.8.0 likely; Panel 1.9.x, 1.10.0b1\[50\]\[51\]\[52\] | MIT / BSD-3 *(unverified)* | Shiny bundles agent skills and LLM-generated Playwright tests (`shiny add test`).\[52\]\[53\] HoloViz ships an MCP server (Panel Live Server, Jun 30 2026)\[54\] | Python reactive frameworks; Panel 2.0 behind schedule |
| **Quarto** | 1.10.x stable (Aug 2026); Quarto 2 Rust rewrite underway\[55\]\[56\] | MIT (bundles GPL Pandoc)\[57\] | Deterministic render to HTML, PDF and slides; 1.9 emits **llms.txt**;\[58\] headless Chrome render | Publishing pipeline, not interactive apps |
| **Slidev** | v52.19.x (Sep 2026)\[59\] | MIT *(unverified)* | Markdown + Vue slides; **built-in MCP server (v52.17, ~Aug 2026)**; official skills; Playwright-based export\[60\]\[61\] | Vue, not React; slides only |
| **Spectacle (Nearform)** | 10.2.3; low activity (last update Apr 2026)\[62\]\[63\] | MIT | React slides as JSX | Stagnant; no agent tooling |

**Pattern** *(judgment)*: in 2026 the winners in this category added three things: **agent skills shipped inside the package** (Streamlit, Gradio, Shiny, Slidev), **an MCP server** (Slidev, HoloViz, Evidence Studio), and **live-session access for agents** (marimo pair). The failures for blind agents are consistent across all of them:
- errors surface in the browser, not on stdout;
- there is no first-class "render, screenshot and report" verification command;
- interactive state lives in the browser session rather than in inspectable files.

The toolkit should treat all three as day-one features.

### 4. TUI fidelity prior art

| Tool | Latest | License | Role for this toolkit |
|---|---|---|---|
| **xterm.js** (`@xterm/xterm`) | 6.0.0 (Dec 22 2025); betas continuous; ~21k stars\[64\]\[65\]\[66\] | MIT | Render live PTY output in the browser (powers VS Code's terminal)\[66\] |
| **asciinema CLI** | 3.x Rust rewrite (3.0.0 Sep 2025; 3.2.0 Mar 2026)\[67\] | **GPL-3.0**\[68\] | Recording format and local streaming. Invoke as a subprocess; do not link or vendor |
| **asciinema-player** | 3.15.1 (Feb 27 2026)\[69\] | Apache-2.0 | Playback of `.cast` recordings with seeking |
| **charmbracelet/vhs** | v0.12.1 (Sep 24 2026)\[70\] | MIT *(unverified)* | Deterministic, scripted `.tape` capture through headless Chrome; ideal for agent-authored, reproducible demos |
| **ttyd** | 1.7.7 (Mar 30 2024), no release since\[71\]\[72\] | MIT *(unverified)* | Proof that PTY-over-WebSocket + xterm.js works. Too stale to depend on |

*(judgment)* "Exact fidelity" means three modes: **live** (own PTY bridge, e.g. Rust `portable-pty` or `node-pty`, plus xterm.js with WebGL renderer and pinned fonts), **recorded** (asciicast v2/v3 + asciinema-player) and **scripted** (VHS-style tape run at build time for deterministic demos). No artifact or data-app tool surveyed offers any of these as a first-class artifact type. json-render's Ink renderer goes the other way (UI rendered *into* a terminal).

## Gap Analysis

What none of the surveyed tools does, and what this toolkit can own:

1. **Durable, server-side inputs owned by the host.**
   - Claude's `window.storage` is a cloud key-value store, 20 MB, text-only and published-only.\[73\]
   - MCP Apps standardizes no storage at all.
   - Streamlit and marimo state dies with the session.
   - No tool offers questionnaire submissions that persist on the user's machine, are versioned, and are delivered back to a specific agent session through a pluggable storage port.
2. **Agent-implemented real actions with an explicit trust boundary.**
   - MCP Apps' app-only tools come closest.
   - No tool lets the agent write the handler (server-side TypeScript next to the React page) and lets the host render a *trusted* confirm control that the artifact cannot spoof.
3. **Review surfaces as a primitive.**
   - Postplan and Artifact Server add comments and versions to static pages.\[26\]\[29\]
   - None offers "N candidates → choose one → comment → structured verdict returned to the agent" as a typed submission.
4. **Blind-agent ergonomics.**
   - Missing everywhere: a CLI that type-checks, builds, renders headlessly, screenshots at named viewports, runs accessibility and console-error checks, and prints machine-readable diagnostics.
   - A2UI's "validation failed error formatting" and Shiny's LLM-written Playwright tests are partial precedents.\[4\]\[53\]
5. **Faithful TUI demos as an artifact type.** Absent from every artifact platform.
6. **One artifact, three surfaces.** No tool runs the same React source as a full-page local app, an embeddable `ui://` MCP App inside chat hosts, and a static export.
7. **Host-agnostic embedding.** Claude Artifacts, v0 and Lovable can't be embedded in a third-party Rust harness. MCP Apps can, but without storage, identity or addressing ports.

*(judgment)* Gaps 1–4 are the moat. Gap 6 is the distribution strategy.

## Positioning Recommendation

**Position:** "The open-source artifact runtime for coding agents. Agents write React; humans get beautiful, durable, interactive pages on their own machine; answers flow back to the agent. Runs standalone, embeds in any harness, exports to MCP Apps."

Ranked options:

| Rank | Positioning | Why | What would overturn it |
|---|---|---|---|
| **1** | **Local artifact runtime + MCP Apps compiler** (recommended) | Owns the empty quadrant; rides the winning standard for distribution instead of fighting it; matches the Rust-harness host | MCP Apps adds a standardized persistence/submission layer *and* hosts allow full-page views, which collapses the gap toward "just an MCP Apps SDK" |
| 2 | Pure MCP Apps framework (like Skybridge, mcp-use, MCP App Studio) | Large host reach | Crowded: the GitHub `mcp-apps` topic page lists 100+ public repositories (another snapshot showed 162), led by mcp-use (10.4k stars), the MCPJam inspector (2.1k) and Skybridge (1.9k). Chat-iframe constraints (CSP, size, no storage) cap capability; loses standalone/local value |
| 3 | Self-hosted Claude-Artifacts clone (like Postplan) | Simple story | Static-page publishing is commoditizing; lacks actions, TUI and host ports; Cloudflare-hosting focus conflicts with local-first |
| 4 | Declarative catalog (A2UI/json-render style) | Safety, streaming | Directly violates "no DSL, no whitelist" |

## Interop Opportunities

| Integration shape | What it is | Est. cost *(judgment)* | Value | Risks |
|---|---|---|---|---|
| **A. Toolkit MCP server** | Tools: `artifact.create`, `artifact.update`, `artifact.list`, `artifact.screenshot`, `artifact.diagnostics`, `submissions.read`, `submissions.wait` (long-poll for feedback, as Postplan and Artifact Server do) | 2–3 engineer-weeks on top of the CLI | Highest: any MCP-capable agent can author and read answers with zero harness work | MCP transport/auth churn across core revisions (2026-07-28 is current core);\[74\] long-poll timeouts in some clients |
| **B. Artifact → `ui://` MCP App export** | Build step bundles the artifact into a single HTML5 file (`text/html;profile=mcp-app`), inlines assets, derives the `_meta.ui.csp` declaration, and swaps the toolkit's transport for an MCP Apps bridge shim (`tools/call` for actions, `ui/message` for submissions, host CSS variables mapped to theme tokens) | 4–6 engineer-weeks, plus ongoing conformance testing across Claude, ChatGPT and VS Code | High: reach into every chat host | Host-specific quirks (ChatGPT extensions, sandbox domains); no host storage, so durable inputs must round-trip via app-only tools back to the toolkit server; size limits; features like PTYs won't work in chat iframes |
| **C. Toolkit as MCP Apps *host*** | The toolkit's own viewer renders third-party `ui://` resources (via `@mcp-ui/client` `AppRenderer`, Apache-2.0) inside artifacts\[75\] | 1–2 engineer-weeks | Medium: artifacts can compose other servers' UIs | Becomes a host with security duties (two-origin proxy) |
| **D. AG-UI adapter** | Emit artifact lifecycle and submission events as AG-UI `CUSTOM`/`STATE_DELTA` events; accept AG-UI runs to drive live views | 1–2 engineer-weeks | Medium-low: reaches CopilotKit, LangGraph, AG2 and similar stacks | AG-UI 1.0 event set still growing; overlap with the MCP path |
| **E. A2UI renderer component** | `<A2UISurface>` React component using the official React renderer, so agents that emit A2UI can drop surfaces into artifacts | ~1 engineer-week | Low-medium | Spec moving from v0.9.1 to v1.0\[20\] |

**Ranked recommendation:** A, then B, then C, then D, then E. A and B together make the toolkit useful to every agent and visible in every chat host. Build the toolkit's internal bridge so that its message shapes map one-to-one onto MCP Apps JSON-RPC (`tools/call`, `resources/read`, `ui/message`, host-context theme variables). Then B becomes a transport swap, not a rewrite. **What would overturn it:** if the primary Rust host prefers a direct process protocol (stdio JSON-RPC) over MCP, promote a native host-port SDK above A. If MCP Apps standardizes state persistence, B gains value and some of the toolkit's server shrinks.

## Adoption Lessons

- **Streamlit:**
  - The "wow" was a pure Python script becoming an app in one command.
  - Agent skills now ship inside the pip package.\[30\]
  - Lesson: zero-config `npx <tool> dev` from a single file, and ship agent instructions *in the package*.
- **shadcn/ui** *(judgment, not re-verified)*:
  - Copy-the-source distribution gave ownership and LLM-friendliness: models can read and edit components.
  - Lesson: ship the design system as editable source, so "beautiful by default" survives agent customization.
- **Vite** *(judgment)*: speed you can feel, plus a framework-neutral plugin API. Lesson: sub-second HMR and a plugin seam for renderers (TUI, motion, slides).
- **Remotion:**
  - The "wow" was React rendered to MP4.
  - The license is a warning: the source-available Remotion License is free for teams of three or fewer. Companies of four or more pay ($25/seat/month for Creators; $0.01/render with a $100/month minimum for Automators; Enterprise from $500/month).\[76\]\[77\]\[78\]\[79\]
  - Embedding the Remotion Player "is considered automation".\[76\]
  - Lesson: **do not make Remotion a mandatory dependency**. It would push license obligations onto every downstream company. Offer it as an opt-in adapter and default to an OSI-licensed animation core.
- **tldraw:**
  - SDK 4.0 (September 2025) enforces licensing changes. The tldraw docs say: "In production (HTTPS on a non-loopback domain with NODE_ENV=production), the SDK requires a valid license key. Without one, the SDK logs errors to the console and, after five seconds, stops rendering the editor."
  - Hobby licenses keep the watermark.\[80\]
  - Lesson: source-available licensing caps embeddability. A host-embeddable toolkit must be MIT or Apache-2.0.
- **Excalidraw:** MIT, no key, no watermark.\[81\] It became the default "safe" embed precisely because of tldraw's licensing.
- **Naming and docs** *(judgment)*: a short, verb-able, npm-available name; docs written for two audiences (humans and an `llms.txt` / agent skill, as Quarto 1.9 and Slidev do); a gallery where each example shows the prompt, the generated source and a screenshot.

## Design Ideas Worth Borrowing

| Idea | Source | How to apply |
|---|---|---|
| App-only tools hidden from the model | MCP Apps `visibility: ["app"]` | Agent-authored action handlers callable only from the page |
| Two-origin sandbox proxy + declared CSP with restrictive default | MCP Apps spec | Serve each artifact on its own origin (e.g., per-artifact subdomain of a loopback host); declare network origins in artifact manifest |
| Standard theme CSS variables | MCP Apps `hostContext.styles` | Use the same variable names as design tokens, so artifacts theme correctly in chat hosts for free |
| `window.storage` get/set/delete/list with personal vs shared scope | Claude Artifacts; reimplemented by Postplan\[28\] | Ship a compatible shim backed by the host storage port, so agent "muscle memory" transfers |
| State vs trigger values | Streamlit Custom Components v2\[33\] | Separate durable form state from one-shot action events in the submission model |
| Agents inside a live session | marimo pair | `submissions.wait` + live artifact inspection tools |
| "Agents wait for sent feedback"; versioned artifacts with comments | Postplan v1.2.0; plannotator Artifact Server\[26\]\[29\] | Review layer: candidates, choose, comment, structured verdict |
| Cached, polyglot data loaders; vanilla JS, no dialect | Observable Framework / Notebooks 2.0 | Build-time and interval data loaders for live data views; no custom syntax |
| Catalog-to-prompt generation, streaming repair | json-render; A2UI v0.9 | Generate an agent skill from the toolkit's component library (guidance, not a whitelist); structured validation errors |
| JSON-Patch state deltas | AG-UI `STATE_DELTA` | Live data view updates over SSE |
| Built-in MCP server + Playwright export | Slidev v52.17 | Same for decks; PDF/PNG export via headless Chromium |
| `llms.txt` output | Quarto 1.9 | Emit `llms.txt` per artifact and for docs |
| Bundled agent skills in the package | Streamlit, Gradio, Shiny | `npx <tool> skills install` |
| Scripted deterministic terminal capture | VHS `.tape` | `<TerminalDemo script=…>` rendered reproducibly at build |
| Frame-deterministic rendering | Remotion | Motion graphics driven by a frame clock so headless screenshots are reproducible |

## Recommendations

1. **License MIT or Apache-2.0** (Apache-2.0 if you want the patent grant), with no telemetry in the core. Keep GPL tools (asciinema CLI) and source-available tools (Remotion, tldraw) behind optional subprocess or plugin boundaries.
2. **Design the internal bridge as MCP Apps-shaped JSON-RPC from day one**, so `ui://` export is a transport swap.
3. **Make blind-agent verification the headline feature:** `check` (types, lint), `render --screenshot --viewport` (headless Chromium), console and network error capture, accessibility audit, and JSON diagnostics on stdout.
4. **Ship third-party-invocation hygiene in core:**
   - loopback bind by default;
   - strict `Host`/`Origin` checks against DNS rebinding;
   - per-artifact unguessable capability tokens;
   - CSRF protection on action endpoints;
   - host-rendered trusted confirm controls for actions.

   Content guardrails stay out of scope, per the commitments.
5. **Launch with a gallery of "wow" demos that no competitor can reproduce:**
   - the inbox with a working Send button;
   - a three-candidate design review with comments flowing back to the agent;
   - a pixel-exact TUI demo;
   - the same dashboard open locally and inside Claude/ChatGPT as an MCP App.

## Caveats

- Several rows were not re-verified in this pass and need a primary-source check before publication: ChatGPT Canvas, v0, Bolt, Lovable, Replit and Val Town; licenses for AI SDK, CopilotKit/AG-UI, assistant-ui, Streamlit, Gradio, Slidev, VHS and ttyd; and star counts outside the ones stated.
- Claude Live Artifacts becoming "legacy" on Aug 19 2026\[82\] and the Claude Code Artifacts beta details come from secondary reporting, not Anthropic primary docs.
- The ext-apps SDK version v1.7.5 comes from a secondary guide.\[74\]
- Engineering-cost estimates are judgment for a team familiar with React, MCP and Rust, and exclude design-system work.
- MCP core revisions (2026-07-28 current) and the A2UI v1.0 candidate are moving targets.\[4\]\[74\] Re-check before freezing interfaces.

## Sources

1. [ext-apps/specification/2026-01-26/apps.mdx at main · modelcontextprotocol/ext-apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
2. [Plugin UI changelog](https://developers.openai.com/apps-sdk/changelog/)
3. [APL · Issue #217 · openai/openai-apps-sdk-examples](https://github.com/openai/openai-apps-sdk-examples/issues/217)
4. [A2UI](https://google.github.io/A2UI/)
5. [Reference](https://developers.openai.com/apps-sdk/reference)
6. [Add UI to your MCP server](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt)
7. [UIResourceRenderer Component](https://mcpui.dev/guide/client/resource-renderer)
8. [@mcp-ui/client - npm](https://www.npmjs.com/package/@mcp-ui/client/v/7.1.1)
9. [MCP Apps in 6 steps: build a server-rendered UI on MCP](https://ecorpit.com/mcp-apps-server-rendered-ui-extension-build-guide-2026/)
10. [GitHub - MCP-UI-Org/mcp-ui: UI over MCP. Create next-gen UI experiences with the protocol and SDK! · GitHub](https://github.com/MCP-UI-Org/mcp-ui)
11. [What Are Claude Artifacts and How to Use Them (2026) - Albato](https://albato.com/blog/publications/how-to-use-claude-artifacts-guide)
12. [Vercel on X: "AI SDK 7 is here. This release sets the foundation for agents and AI platforms in production: approvals, durability, telemetry, and more." / X](https://x.com/vercel/status/2070155382488764566)
13. [Releases · vercel/ai](https://github.com/vercel/ai/releases)
14. [Vercel AI SDK 7: The Production Agent Upgrade](https://www.developersdigest.tech/blog/vercel-ai-sdk-7-production-agents)
15. [Multi-Step & Generative UI](https://vercel.com/academy/ai-sdk/multi-step-and-generative-ui)
16. [Beyond the Chatbot: Building Generative UI with Vercel AI SDK](https://medium.com/vannguardai/beyond-the-chatbot-building-generative-ui-with-vercel-ai-sdk-f8b73cec6e2b)
17. [Vercel Releases JSON-Render: a Generative UI Framework for AI-Driven Interface Composition - InfoQ](https://www.infoq.com/news/2026/03/vercel-json-render/)
18. [json-render by vercel-labs - SourcePulse](https://www.sourcepulse.org/projects/25901769)
19. [A2UI v0.9: What's New in Google's Generative UI Spec](https://www.copilotkit.ai/blog/a2ui-whats-new-in-google-generative-ui-spec)
20. [Google Releases A2UI v0.9: Portable, Framework-Agnostic Generative UI - InfoQ](https://www.infoq.com/news/2026/07/google-a2ui-genui/)
21. [The Developer's Guide to the AG-UI Protocol](https://www.copilotkit.ai/blog/developers-guide-to-the-ag-ui-protocol)
22. [AG-UI](https://docs.copilotkit.ai/agentic-protocols/ag-ui)
23. [AG-UI Protocol](https://deepwiki.com/CopilotKit/CopilotKit/6-ag-ui-protocol)
24. [assistant-ui/assistant-ui @assistant-ui/react-mcp@0.1.17 on GitHub](https://newreleases.io/project/github/assistant-ui/assistant-ui/release/@assistant-ui/react-mcp@0.1.17)
25. [GitHub - assistant-ui/mcp-app-studio-starter: Starter template for MCP App Studio · GitHub](https://github.com/assistant-ui/mcp-app-studio-starter)
26. [Release v1.2.0 · notsuhas/postplan](https://github.com/notsuhas/postplan/releases/tag/v1.2.0)
27. [GitHub - notsuhas/postplan: Open-source alternative to Claude Artifacts for every coding agent. Any agent ships a self-contained page or app to a live URL — Claude Code, Cursor, Codex, Cline, any harness — then you review in the browser and it fixes. Self-hosted, \$0 on Cloudflare's free tier.](https://github.com/notsuhas/postplan)
28. [feat(db): window.storage, the Claude artifacts storage API by notsuhas · Pull Request #20 · notsuhas/postplan](https://github.com/notsuhas/postplan/pull/20)
29. [GitHub - plannotator/artifact-server: Open source alternative to Claude artifacts. · GitHub](https://github.com/plannotator/artifact-server)
30. [2026 release notes - Streamlit Docs](https://docs.streamlit.io/develop/quick-reference/release-notes/2026)
31. [2025 release notes - Streamlit Docs](https://docs.streamlit.io/develop/quick-reference/release-notes/2025)
32. [Custom components v2 - Streamlit Docs](https://docs.streamlit.io/develop/concepts/custom-components/components-v2)
33. [Overview of custom components - Streamlit Docs](https://docs.streamlit.io/develop/concepts/custom-components/overview)
34. [Releases · gradio-app/gradio](https://github.com/gradio-app/gradio/releases)
35. [gradio-app/gradio gradio@6.7.0 on GitHub](https://newreleases.io/project/github/gradio-app/gradio/release/gradio@6.7.0)
36. [Update dependency marimo to \>=0.24,\<0.25 by renovate\[bot\] · Pull Request #192 · gulfofmaine/climatology\_py\_dash](https://github.com/gulfofmaine/climatology_py_dash/pull/192)
37. [marimo · GitHub](https://github.com/marimo-team)
38. [Blog](https://marimo.io/blog)
39. [Marimo vs Jupyter 2026: Reactive Python…](https://pythondatabench.com/article/marimo-vs-jupyter-reactive-python-notebooks)
40. [Newsletter 23](https://marimo.io/blog/newsletter-23)
41. [Releases · observablehq/framework](https://github.com/observablehq/framework/releases)
42. [Making the new Observable the default soon - Announcements - The Observable Forum](https://talk.observablehq.com/t/making-the-new-observable-the-default-soon/10775)
43. [observablehq/framework](https://www.npmjs.com/package/@observablehq/framework)
44. [Tom MacWright: Observable Notebooks 2.0](https://simonwillison.net/2025/Aug/6/observable-notebooks-20/)
45. [Try the new Observable today - Announcements - The Observable Forum](https://talk.observablehq.com/t/try-the-new-observable-today/10698)
46. [About](https://new.observablehq.com/about)
47. [Evidence · GitHub](https://github.com/evidence-dev)
48. [Evidence Core](https://evidence.dev/blog/evidence-core)
49. [GitHub - evidence-dev/evidence: Business intelligence as code: build fast, interactive data visualizations in SQL and markdown · GitHub](https://github.com/evidence-dev/evidence)
50. [panel · PyPI](https://pypi.org/project/panel/)
51. [Blog post: Shiny for Python 1.8 by schloerke · Pull Request #401 · posit-dev/open-source-website](https://github.com/posit-dev/open-source-website/pull/401)
52. [py-shiny/CHANGELOG.md at main · posit-dev/py-shiny](https://github.com/posit-dev/py-shiny/blob/main/CHANGELOG.md)
53. [Releases · posit-dev/py-shiny](https://github.com/posit-dev/py-shiny/releases)
54. [HoloViz Blog](https://blog.holoviz.org/index.html)
55. [Quarto 1.10 :: Posit Open Source](https://opensource.posit.co/blog/2026-08-03_quarto-1-10/)
56. [Quarto (software)](<https://en.wikipedia.org/wiki/Quarto_(software)>)
57. [quarto-cli - AUR (en) - Arch Linux](https://aur.archlinux.org/packages/quarto-cli)
58. [Quarto 1.9 :: Posit Open Source](https://quarto.org/docs/blog/posts/2026-03-24-1.9-release/)
59. [slidevjs/slidev v52.19.1 on GitHub](https://newreleases.io/project/github/slidevjs/slidev/release/v52.19.1)
60. [slidevjs/slidev v52.11.4 on GitHub](https://newreleases.io/project/github/slidevjs/slidev/release/v52.11.4)
61. [slidevjs/slidev v52.17.0 on GitHub](https://newreleases.io/project/github/slidevjs/slidev/release/v52.17.0)
62. [Nearform Commerce · GitHub](https://github.com/formidablelabs)
63. [Releases · FormidableLabs/spectacle](https://github.com/FormidableLabs/spectacle/releases)
64. [Releases · xtermjs/xterm.js](https://github.com/xtermjs/xterm.js/releases)
65. [xterm.js · GitHub](https://github.com/xtermjs)
66. [GitHub - xtermjs/xterm.js: A terminal for the web · GitHub](https://github.com/xtermjs/xterm.js/)
67. [asciinema/CHANGELOG.md at develop · asciinema/asciinema](https://github.com/asciinema/asciinema/blob/develop/CHANGELOG.md)
68. [asciinema · GitHub](https://github.com/asciinema)
69. [Releases · asciinema/asciinema-player](https://github.com/asciinema/asciinema-player/releases)
70. [Release v0.12.1 · charmbracelet/vhs](https://github.com/charmbracelet/vhs/releases/tag/v0.12.1)
71. [Release 1.7.7 · tsl0922/ttyd](https://github.com/tsl0922/ttyd/releases/tag/1.7.7)
72. [Releases · tsl0922/ttyd](https://github.com/tsl0922/ttyd/releases)
73. [Can Claude Artifacts Save Data? What Persists and What Silently Disappears · Caipi Field Notes](https://caipi.ai/blog/can-claude-artifacts-save-data)
74. [MCP Apps: Interactive UI, Architecture & Security Guide](https://mcpblog.org/mcp-apps/)
75. [@mcp-ui/client Overview](https://mcpui.dev/guide/client/overview)
76. [Terms and Conditions of Remotion (v5.0)](https://www.remotion.dev/docs/terms)
77. [License & Pricing](https://www.remotion.dev/docs/license/pricing)
78. [License FAQ](https://www.remotion.dev/docs/license/faq)
79. [Is Remotion Free? License and Pricing Explained (2026)](https://autoae.online/blog/is-remotion-free)
80. [License key • tldraw Docs](https://tldraw.dev/sdk-features/license-key)
81. [Best Open-Source Whiteboard Tools in 2026: Excalidraw vs tldraw vs Miro](https://meetrix.io/blogs/open-source-whiteboard-tools/)
82. [Claude Live Artifacts Are Legacy: What to Use Now (2026)](https://markloop.io/blog/claude-live-artifacts/)
