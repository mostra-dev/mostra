# Agent-Native Artifact Toolkit: Agent Ergonomics, Verification Loop, Distribution and Repository Blueprint (October 2026)

The decisive bet for this toolkit is not the component library. It is a closed, machine-readable verification loop (build → render → console/network/a11y capture → multi-viewport screenshots → structured JSON verdict) delivered as a CLI plus an Agent Skill, with MCP and MCP Apps added on top. Current 2026 benchmarks show that LLM-generated UIs fail mostly in ways only a rendered browser reveals, and that they fail more as an artifact evolves across turns. As of October 2026 the stack to build it is clear: Playwright, the MCP 2026-07-28 spec plus the MCP Apps extension, Agent Skills, and AGENTS.md. Repository engineering should follow: pnpm + Turborepo + Changesets + tsdown + Vitest 4 + Playwright, Apache-2.0 with DCO, and a conformance kit for hosts from day one.

## TL;DR

- **Ergonomics:** Ship one Agent Skill (SKILL.md, under 5,000 tokens) plus AGENTS.md, an llms.txt/llms-full.txt docs index, and a copy-pasteable template/example gallery. The API should be plain React/TS with few concepts and conventional names. Every error should be agent-readable JSON with a stable code, a fix hint and a docs URL. llms.txt is cheap optionality: Ahrefs' Jun 15 2026 study of 137,210 domains found that 97% of llms.txt files got zero requests in May 2026, and AI retrieval bots made up only 1.1% of the requests that did arrive. Skills and AGENTS.md are the surfaces agents actually load.
- **Verification:** Build `verify` into the CLI, running on Playwright (Chromium headless shell by default, WebKit optional). It captures Vite/esbuild compile errors, page errors, console messages, failed requests, axe-core violations, an ARIA snapshot, and screenshots at 3 viewports. It returns one JSON report plus PNG paths. A 3-viewport pass costs about 2.5–3k image tokens (well under $0.02 on Claude Opus 4.7 pricing). Prefer CLI+skill over browser MCP servers: Mario Zechner measured (Nov 2025) that tool schemas alone cost 13.7k tokens for Playwright MCP (21 tools) and 18.0k tokens for Chrome DevTools MCP (26 tools) per session.
- **Distribution and engineering:** Use one core with four faces: the CLI (`--json`, non-interactive, documented exit codes), an MCP server on spec 2026-07-28 with an optional MCP Apps `ui://` view, a TypeScript SDK, and a language-neutral host protocol in JSON Schema 2020-12 + OpenAPI with a hand-curated Rust client. Oxide's typify/progenitor are still Draft-7/OpenAPI-3.0-bound.\[1\]\[2\] Plugins for Claude Code, Codex, Gemini CLI, Cursor and Copilot all share one `skills/` directory. Use pnpm 11 (evaluate 12), Turborepo, Changesets, tsdown, TypeScript 7, Vitest 4, Playwright, npm trusted publishing, and Apache-2.0 + DCO, with an AAIF/LF path held open.

## Key Findings (verified facts, with dates)

| Area | Verified fact (Oct 2026) | Implication |
|---|---|---|
| MCP spec | Current revision is **2026-07-28** (stable, released Jul 28 2026; RC May 2026).\[3\]\[4\] It has a stateless core (no `initialize` handshake, no `Mcp-Session-Id`), Multi Round-Trip Requests (`resultType: "input_required"`), required `Mcp-Method`/`Mcp-Name` headers, cacheable lists (`ttlMs`, `cacheScope`), and a formal extensions framework (MCP Apps, Tasks, Enterprise-Managed Authorization). It deprecates Roots, Sampling and Logging under a ≥12-month deprecation policy, and deprecates DCR in favor of CIMD. Tier 1 SDKs are TypeScript, Python, Go and C#; the Rust SDK supports the spec in beta.\[5\] | Design the MCP server stateless from the start. Pass explicit handles (artifact IDs) as tool args, not session state.\[5\] |
| MCP Apps | SEP-1865 was proposed Nov 2025 and launched as the first official extension on Jan 26 2026.\[6\]\[7\] Tools declare `_meta.ui.resourceUri` pointing at a `ui://` resource. Hosts render it in a sandboxed iframe that talks JSON-RPC over postMessage.\[7\]\[8\] The official page lists Claude, Claude Desktop, VS Code GitHub Copilot, Microsoft 365 Copilot, Goose, Postman, MCPJam and Archestra.AI as hosts.\[9\] OpenAI docs say ChatGPT implements the open standard (alias `openai/outputTemplate`).\[10\] | A cheap, high-reach "inline preview" surface. It does not replace the local browser (sandboxed, CSP-restricted, host-controlled). |
| Agent Skills | Anthropic introduced skills Oct 16 2025 and published the format as an open standard on Dec 18 2025 (agentskills.io; spec at github.com/agentskills/agentskills).\[11\]\[12\] Progressive disclosure: name+description at startup, full SKILL.md on activation (<5,000 tokens recommended), scripts/references on demand.\[13\]\[14\] agentskills.io lists 40+ clients (Sept 2026), including Claude, Codex, GitHub Copilot, VS Code, Cursor, Gemini CLI, Goose, OpenHands and Amp.\[11\]\[12\]\[15\] | The single highest-leverage doc artifact. One skill works across harnesses. |
| AGENTS.md / AAIF | The Linux Foundation formed the Agentic AI Foundation on Dec 9 2025 with MCP (Anthropic), goose (Block) and AGENTS.md (OpenAI).\[16\] agentgateway joined in Jun 2026.\[17\] AAIF reported 247 member orgs on Aug 13 2026.\[18\] | Ship AGENTS.md in the repo and in templates. AAIF is the natural foundation target later. |
| llms.txt | Jeremy Howard proposed it Sept 2024. No W3C/IETF status.\[19\]\[20\] Adoption: 8.7% of the top 1,000 sites (Rankability, Jun 2026) and 5.61% of the top 10,000 (HTTP Archive analysis, Jun 2026).\[21\]\[22\] Ahrefs' Jun 15 2026 study of 137,210 domains found 97% of llms.txt files got zero requests in May 2026; AI retrieval bots made up only 1.1% of the requests that did arrive, and the 28% of domains with a valid file is, by Ahrefs' own caveat, an upper bound because its customers skew technical. IDE agents and docs MCP servers do consume it when pointed at docs.\[23\] | Publish it (near-zero cost), but don't count on it. |
| UI-quality evidence | EvoGenUI-Bench (NYU Shanghai, arXiv 2608.29387, Aug 29 2026) has 150 five-turn tasks. The best of 8 models reached 74.9% turn pass but only 37.3% of full five-turn episodes. Pass retention fell to 52.4% on tool-grounded tasks. Evaluation uses screenshots + DOM + actor traces + runtime logs.\[24\] ArtifactsBench (arXiv 2507.04952) has 1,825 tasks with temporal screenshots and an MLLM judge over 30+ LLMs.\[25\] | Multi-turn maintenance of a stateful artifact, which is exactly our use case, is where agents fail. The loop has to check regressions across turns, not just render once. |
| Playwright | The latest release found is 1.62.1 (Jul 30 2026).\[26\] 1.56 added `page.consoleMessages()`, `page.pageErrors()` and `page.requests()` plus Test Agents (planner/generator/healer).\[27\]\[28\] 1.59 focused on agents, screencasts and trace CLI. 1.60 (May 2026) added HAR tracing, ARIA bounding boxes and `errorContext`.\[29\] The Playwright MCP README itself says coding agents "increasingly favor CLI-based workflows exposed as SKILLS over MCP" for token efficiency.\[30\] | Use the Playwright library directly inside our CLI. Don't make agents drive a browser MCP for routine verification. |
| Image tokens | Claude: ≈ width×height/750. Opus 4.7 raises the long edge cap to 2,576 px; its new tokenizer produces 1.0–1.35× tokens; input costs $5/M. GPT-5.5: 32×32 patches, `high` detail caps at 2,500 patches/2,048 px; omitted/`auto` detail behaves like `original`; input costs $5/M. Gemini 3.1 Pro: 258 tokens per 768×768 tile; input costs $2/M (Roboflow, May 2026).\[31\] | A screenshot costs on the order of 1–1.4k tokens. Always set dimensions/detail explicitly. |
| TypeScript | TS 6.0 (Mar 2026) was the last JS-based compiler.\[32\] **TS 7.0 shipped Jul 8 2026 (npm 7.0.2)**.\[33\]\[34\] It is the Go-native compiler shipped as `tsc`, which Microsoft's Jul 8 2026 announcement calls "a 10x faster native port of TypeScript" (its full-build benchmarks reportedly range from 7.7× to 11.9×). The programmatic API is reported to still be in progress.\[34\] | Use TS 7 for type-checking. Keep a pinned TS 6.0.x for tools that need the JS compiler API (API Extractor, some dts tooling). |
| pnpm | pnpm 11.0 (Apr 28 2026; Node 22+, pure ESM), now at 11.28.5 (Oct 6 2026), supported to Apr 30 2027.\[35\]\[36\]\[37\] pnpm 12.0 (Aug 26 2026) is a Rust rewrite, stable and compatible with v11 commands/lockfile, but npm's `latest` tag still pointed at 11 in early Sept 2026.\[38\]\[39\]\[40\] Catalogs accept `workspace:` ranges since 11.26.\[41\] | Standardize on pnpm 11 + catalogs now, and trial 12 in CI. |
| Vitest | Vitest 4.0 (Oct 22 2025) made Browser Mode stable and added `toMatchScreenshot` visual regression, Playwright traces, and separate provider packages (`@vitest/browser-playwright`).\[42\]\[43\] A Browser Mode advisory (CDP providers with the browser API exposed to the network allowed host code execution) was fixed in 4.1.8 / 3.2.6 / 5.0.0-beta.4.\[44\] | Use Vitest 4.1.8+ for component tests in a real browser, bound to localhost. |
| npm publishing | Trusted publishing (OIDC) has been GA since Jul 31 2025. It needs npm CLI ≥11.5.1 and gives automatic provenance for public repos.\[45\] Maintainers quoting the npm registry banner report that tokens which bypass 2FA are being restricted (account changes Aug 2026, direct publishing Jan 2027).\[46\]\[47\] | OIDC-only publishing from day one. No `NPM_TOKEN`. |
| Localhost security | Vite CVE-2025-24010: any website could read dev-server responses through permissive CORS, a missing WebSocket Origin check and a missing Host check (fix: `server.allowedHosts`).\[48\] webpack-dev-server has a long DNS-rebinding history; CVE-2026-14631 (Jul 2026) is a DoS via a malformed Host/Origin, fixed in 5.2.6.\[49\]\[50\] The MCP TypeScript SDK had a DNS-rebinding CVE-2025-66414 (Dec 2025).\[51\] | Host allowlist + Origin check + per-session token + CORP are mandatory in our local server. |
| Rust codegen | typify 0.8.0 (2026-09-09, Apache-2.0) is "basically Draft 7"; 2020-12 "sometimes works, and often breaks" (author, May 2026).\[1\]\[52\]\[53\] It pins schemars ^0.8.\[54\] progenitor 0.15.0 (2026-09-10, MPL-2.0) targets OpenAPI 3.0.x only.\[2\]\[55\]\[56\] schemars 1.2.2 (Jul 2026) is the current line.\[57\] | Don't rely on full auto-generation for the Rust client. Generate wire types from a constrained schema subset, and hand-write the client. |
| Conformance precedent | The MCP conformance suite (`@modelcontextprotocol/conformance`, CLI + GitHub Action) tests clients and servers per scenario and per spec version, with expected-failure baselines.\[58\]\[59\] SEP-1730 SDK tiers require 100% (Tier 1) / 80% (Tier 2) conformance.\[60\]\[61\] Draft SEP-3405 (Sept 30 2026) would make tiers purely conformance-driven.\[62\] | Copy this pattern for our host-port conformance kit. |

---

## 1. Agent-Ergonomics Design

### 1.1 What the evidence says (facts, then judgment)

**Facts.**
- Generated-UI quality has moved from "can it render" to "can it stay correct." In EvoGenUI-Bench the strongest model completed only 37.3% of five-turn episodes despite a 74.9% per-turn pass rate. Failures cluster in information architecture (presentation), derived-state propagation and affordance binding (interaction), and external-state grounding (tool-grounded tasks).\[24\]
- The benchmark authors conclude that "neither a final screenshot nor an isolated turn score adequately captures generative UI reliability." Their evaluator packet contains the request, generated UI, build result, browser trace, final DOM, screenshot and runtime logs.\[24\]
- ArtifactsBench likewise renders artifacts and judges temporal screenshots with an MLLM judge against per-task checklists.\[25\]
- Research on feedback loops is consistent in direction. Examples: UICoder (automated compiler/visual feedback fine-tuning, NAACL 2024); designer-feedback fine-tuning (Wu et al., CHI 2026, 1,460 annotations from 21 designers); UI2Code^N (iterative render-and-polish); 1D-Bench (iterative UI generation with visual feedback, Feb 2026).\[63\]\[64\]\[65\]\[66\]

**Judgment.**
- Our artifact types are stateful, multi-turn and tool-grounded (forms persisting server-side, live data, agent-authored actions). Those are the weakest categories in current benchmarks.
- So the ergonomics must optimize for two things: (a) first-try correctness through a small, conventional API, and (b) cheap, honest regression detection across edits.
- Make "beautiful by default" the job of the component kit and theme. Don't make it the agent's job.

### 1.2 Documentation surfaces for LLMs — comparison and ranking

| Surface | Status (Oct 2026) | Who loads it | Cost to us | Rank |
|---|---|---|---|---|
| **Agent Skill** (`skills/artifact-toolkit/SKILL.md` + `references/` + `scripts/`) | Open standard since Dec 18 2025; 40+ clients\[11\]\[15\] | Claude Code, Codex, Copilot, Cursor, Gemini CLI, Goose, etc. (auto-discovered by description) | Low | **1** |
| **AGENTS.md** in repo root and in every scaffolded project | AAIF project; widely adopted | Codex, Cursor, Copilot, Gemini CLI, Claude Code (via import), others | Very low | **2** |
| **Example gallery + templates** (`atk new --template dashboard`) | n/a | Agents copy working code; the most reliable "doc" | Medium | **3** |
| **Typed API + TSDoc** (types are documentation the agent reads via LSP/`node_modules`) | n/a | Every agent that reads `.d.ts` | Low (discipline) | **4** |
| **llms.txt / llms-full.txt / per-page `.md`** | Community convention; low measured fetch rates\[20\]\[67\] | IDE agents when pointed at docs; docs MCP servers | Very low (generated) | **5** |
| **Docs MCP server / `atk docs search`** | Optional | Harnesses without web access | Medium | 6 |

**Ranked recommendation:** Skill > AGENTS.md > templates/gallery > types/TSDoc > llms.txt > docs MCP.
- **Reason:** Skills and AGENTS.md are loaded automatically into the agent's working context at the moment of need. Templates and types are "docs" the agent can't misread. llms.txt depends on someone pointing the agent at it.
- **What would overturn it:** (1) a major harness dropping skill auto-activation, or the spec fragmenting (watch per-client frontmatter extensions); (2) frontier vendors starting to fetch llms.txt at inference time (no vendor documents this as of Jul 2026).\[67\]

**Precedents worth copying (judgment, based on their published patterns):**
- shadcn/ui: a registry plus an MCP server, so agents fetch component source rather than guessing APIs.
- Vercel AI SDK, Remotion, Motion and Expo: they publish LLM-oriented docs/rules.
- tsdown publishes `/llms.txt` and `/llms-full.txt`.\[68\]
- Their common pattern: *source-of-truth examples that agents can copy*, not prose. No rigorous public effectiveness study exists for any of them. Treat their success as anecdotal.

### 1.3 Skill design (concrete)

```
skills/artifact-toolkit/
├── SKILL.md              # ≤ ~400 lines, < 5k tokens: when to use, 5 core concepts, the edit→verify loop, top 15 error codes
├── references/
│   ├── components.md     # generated from TSDoc; one table per component
│   ├── data-and-actions.md  # useQuery/useLive/defineAction/forms persistence
│   ├── presentations.md  motion.md  tui.md  review-surfaces.md
│   └── host-integration.md
├── templates/ → symlink-free copies (Codex does not follow symlinks; see §3.4)
└── scripts/verify.sh     # thin wrapper over `atk verify --json`
```

SKILL.md description (this is the trigger text): "Create, run and verify interactive browser artifacts (dashboards, forms, slide decks, demos, review/choice surfaces, live data views, TUI demos) with the atk toolkit; use whenever the user wants something visual or interactive rather than text." The body mandates the loop: **edit → `atk verify --json` → read report → fix → repeat until `status: "pass"` → `atk open`**.

### 1.4 API design rules LLMs get right first time

These are judgment rules, derived from the evidence above and from widely used React conventions:

1. **Plain React, file-based conventions.** `artifact.tsx` default-exports a component. There is no registration step. Optional `artifact.config.ts` uses `defineArtifact({...})`. MDX is supported for decks/docs.
2. **≤7 core concepts**, each with a name agents already know:
   - `<Artifact>` (page shell + theme)
   - layout primitives (`Stack`, `Grid`, `Card`)
   - `useQuery`/`useLive` (data, TanStack-style naming)
   - `defineAction` (server-side function bound to a button; zod-typed input)
   - `<Form>` with `useField` (persists via the host storage port)
   - `<Choice>`/`<Review>` (candidates + selection + comments)
   - `<Slides>`/`<Slide>`
   
   Anything else is ordinary npm (Recharts/ECharts, Motion, Remotion player, xterm.js) wrapped with themed defaults.
3. **Conventional prop names**: `value/onChange`, `items`, `title`, `variant`, `size`, `disabled`, `loading`. No bespoke synonyms. Use string-literal unions, not enums.
4. **Types as guardrails.** Discriminated unions for variants, `satisfies`-friendly config, branded IDs for artifacts/actions. TS errors should read like instructions. Use template-literal types for messages where useful (e.g. `"defineAction: input schema required — pass z.object({...})"`).
5. **Conventions over config**: zero-config theme with a beautiful default and dark mode, responsive by default, and an accessible primitive base (Radix/React Aria-class primitives).
6. **One way to do each thing.** Ban aliases. Deprecations ship codemods (`atk migrate`).
7. **Stable `data-testid`-free selectors.** Components render semantic roles/labels so that ARIA snapshots and synthetic tests work without agent effort.

### 1.5 Errors written for agents

Every diagnostic (CLI, dev overlay, verify report, SDK exception) uses one schema:

```json
{
  "code": "ATK_ACTION_NO_SCHEMA",
  "severity": "error",
  "message": "defineAction('send') has no input schema.",
  "file": "artifact.tsx", "line": 42, "column": 7,
  "hint": "Pass `input: z.object({ to: z.string(), body: z.string() })` as the first option.",
  "fix": { "kind": "replace", "range": [42,7,42,31], "text": "defineAction({ input: z.object({...}), run })" },
  "docs": "https://atk.dev/errors/ATK_ACTION_NO_SCHEMA",
  "phase": "compile|runtime|console|network|a11y|visual|contract"
}
```

Rules:
- Stable codes are part of the semver surface.
- Every code has a docs page with a minimal fix example. llms.txt indexes them all.
- Human output is a rendering of the same object.
- `--json` never mixes prose into stdout. Logs go to stderr.
- Cap repeated errors: dedupe console spam into one entry with `count`.

---

## 2. Verification-Loop Design

### 2.1 Engine options — comparison

| Option | Version / license | Strengths | Weaknesses for our loop | Rank |
|---|---|---|---|---|
| **Playwright library (in our CLI)** | 1.62.x (Jul 2026), Apache-2.0, Microsoft, monthly cadence | Chromium/Firefox/WebKit; console/pageerror/requests APIs; ARIA snapshots; tracing/HAR; screenshot control; headless shell | Browser download (~100+ MB); we own orchestration | **1** |
| Vitest 4 Browser Mode | 4.x, MIT | Real-browser component tests, `toMatchScreenshot` | Test-runner shaped, not an "inspect this artifact" tool | 2 (for our own repo tests) |
| Puppeteer | Apache-2.0, Google | CDP-native, Chrome for Testing | Chrome/Firefox only; fewer test affordances | 3 |
| Chrome DevTools MCP | Google, Chrome-only | Perf traces, deep network/console debugging | 18.0k tokens of tool schema for 26 tools (Zechner, Nov 2025); Chrome-only | Escalation tool |
| Playwright MCP / Playwright CLI | Microsoft | Agent-driven exploration | Accessibility snapshot per action inflates context; MS itself recommends CLI+skills\[30\]\[69\] | Escalation tool |
| agent-browser (Vercel) and similar CLIs | Chromium | Very low token use reported | No test runner/assertions; third-party benchmarks only\[70\] | Optional |

Token figures for browser MCPs are illustrative and come from third-party write-ups. Pramod Dutta (Medium, Nov 2025), citing Microsoft's benchmarks, reports about 114k tokens via Playwright MCP versus about 27k via Playwright CLI for the same test; a separate blog put DevTools MCP at about 50k and agent-browser at about 7k for a 10-step task. Treat these as directional, not verified.

**Recommendation:** embed the Playwright library behind `atk verify`. Expose browser-MCP servers only as an escalation path documented in the skill.
- **Overturn if:** Playwright's licensing/maintenance changed (no sign of that), or a harness-native browser (e.g. built-in Claude/Codex browser tools) became universal and could be scripted deterministically.

### 2.2 The `atk verify` pipeline

1. **Static/compile (no browser, <1–3 s typical).**
   - Type-check with TS 7 `tsc --noEmit` on the artifact.
   - Vite/esbuild/Rolldown build in-process. Map the build errors (file/line/frame) to the diagnostic schema.
   - Lint rules for known pitfalls (missing `key`, hooks rules, unbounded intervals, `fetch` to undeclared origins as a *warning only*, consistent with the no-guardrails stance).
2. **Boot.** Start the artifact server on `127.0.0.1:<random>` with a session token. Health-check it.
3. **Render (headless Chromium shell, reused across runs via a warm daemon).**
   - Navigate. Wait for `networkidle`, then the toolkit's own `data-atk-ready` signal (components report readiness; suspense settled; fonts loaded).
   - Collect `pageerror`, `console` (error/warn), failed and 4xx/5xx requests, unhandled rejections, React error boundaries (the toolkit ships an instrumented boundary), and long tasks.
4. **Accessibility.** Run axe-core (MPL-2.0) on each viewport. Report violations by impact. Capture an ARIA snapshot (YAML), which serves as a cheap text-only "what's on screen" summary for non-vision models.
5. **Screenshots.** Default viewports are 1280×800 desktop, 390×844 mobile and 768×1024 tablet (opt-in). Also full-page if the page is <3× viewport height, plus a reduced-motion pass for motion artifacts. Optionally capture the dark theme. Save PNG/WebP paths and a small contact sheet.
6. **Synthetic interaction smoke test.**
   - Auto-generated: click every enabled button/link (with actions in **dry-run mode** via the action port), fill forms with schema-derived values, tab through focusable elements, flip slides, and toggle a `<Choice>`.
   - Assert no new errors and expected state change (DOM diff).
   - Author-supplied: `artifact.test.ts` with Playwright-style steps.
7. **Regression (multi-turn).** Compare against the last passing run: ARIA-snapshot diff, pixel diff (threshold), and contract checks (forms/actions still present and wired). This directly targets the EvoGenUI failure mode of "earlier requirements silently broken."
8. **Verdict.** One JSON document: `status`, `diagnostics[]`, `screenshots[] {path, viewport, tokensEstimate}`, `a11y`, `interactions`, `regressions`, `timingsMs`. Exit codes: 0 pass, 1 artifact failures, 2 usage error, 3 environment error (no browser), 4 timeout.

**Latency targets (judgment):**
- Warm daemon: compile+render+one viewport in ≤2–4 s; full 3-viewport + axe + smoke in ≤8–15 s.
- Cold start adds a browser launch (typically 1–3 s for headless shell) plus first build.

These are engineering targets, not measured figures. Publish real numbers from CI benchmarks.

### 2.3 Screenshot token/cost budget

All figures below are computed with the vendors' published formulas. These are estimates.

| Viewport (1× DPR) | Claude (w×h/750) | GPT-5.5 (32-px patches) | Gemini 3.1 Pro (258/768-tile) |
|---|---|---|---|
| 1280×800 | ≈1,365 tokens (≈$0.0068 at $5/M) | ≈1,000 | ≈1,032 (4 tiles) |
| 390×844 | ≈439 | ≈351 | ≈516 |
| 768×1024 | ≈1,049 | ≈768 | ≈516–1,032 |
| 3-viewport pass | ≈2.85k (≈$0.014) | ≈2.1k | ≈2.1–2.6k |

Design rules:
- Capture at DPR 1 by default. DPR 2 quadruples tokens.
- Crop to the artifact root.
- Return images only when `status != pass` or when the agent passes `--screenshots=always`. Otherwise return the ARIA snapshot text.
- Include `tokensEstimate` per image so harnesses can budget.
- Set GPT `detail` explicitly, because omitted/`auto` behaves like `original` on GPT-5.5.

### 2.4 Terminal/TUI fidelity

- Run TUI apps under a real PTY (node-pty) streaming into **xterm.js** (MIT) in the artifact page.
- Verification uses a "golden" path:
  - (a) Use the xterm.js serialize addon (`@xterm/addon-serialize`) and buffer API for text-level snapshots (cells, colors, cursor). These are deterministic and cheap to diff.
  - (b) Take pixel screenshots with bundled fonts (ship a fixed monospace webfont, disable font fallback, fixed cols×rows) to avoid DPI/font-fallback drift. UI2Code^N notes that this kind of rendering variance is invisible without actual rendering.\[66\]
- Smoke tests send keystroke scripts, then assert on buffer text.

---

## 3. Distribution Plan

### 3.1 CLI (primary surface)

These are judgment rules, consistent with clig.dev-style guidance and agent constraints:
- Commands: `atk new | dev | verify | open | screenshot | build | export | doctor | docs | migrate | mcp | host`.
- Every command supports `--json` (one JSON document on stdout; NDJSON for streaming `dev --json`).
- It is non-interactive when `!isTTY` or `CI`/`--yes`, and never prompts in JSON mode.
- Exit codes are documented.
- `--cwd`, `--port 0`, `--no-open`, `--timeout`.
- `atk doctor --json` reports browser install, ports, and versions.
- Every command is idempotent (re-running `new` into an existing dir errors with a code).
- `atk dev` prints the URL plus a token-bearing link.
- Long-running commands emit progress events, not spinners, in JSON mode.

### 3.2 MCP server design (spec 2026-07-28)

- **Tools** (model-controlled actions): `artifact_create`, `artifact_verify` (returns structured output with an `outputSchema` plus image content for failing viewports), `artifact_open`, `artifact_list`, `submissions_get`.
  - Keep the tool count ≤8 with terse descriptions. List results carry `ttlMs`/`cacheScope` so catalogs cache.
  - Because the protocol is stateless, return an `artifactId` handle and accept it on every call.\[5\]
- **Resources** (application-controlled context): `atk://docs/{topic}`, `atk://artifacts/{id}/report`, `atk://artifacts/{id}/screenshot/{viewport}`.
- **Prompts**: one or two slash-command entry points ("Build a dashboard from this data").
- **MRTR** (input_required) for confirmations (e.g. "overwrite existing artifact?"), not long-lived streams.\[5\]
- **MCP Apps**: `artifact_open` declares `_meta.ui.resourceUri: "ui://atk/viewer"`. In supporting hosts (Claude, VS Code Copilot, ChatGPT, Goose…) the artifact renders inline in a sandboxed iframe through `@modelcontextprotocol/ext-apps`.\[9\]\[71\] Host-rendered trusted controls (e.g., "Send") map to the host-port concept. Always provide a plain URL fallback.
- Avoid deprecated Sampling/Roots/Logging.\[5\] Use stdio for local, Streamable HTTP for remote. Apply the localhost hygiene of §4.6 to the HTTP transport.

### 3.3 TypeScript SDK and language-neutral host protocol

- **`@atk/sdk`**: `createToolkit({ ports: { storage, events, identity, addressing, trustedControls } })`, plus `startServer`, `verify`, and `render`. ESM-only, Node ≥22.
- **Host protocol** (what the Rust harness speaks): JSON-RPC 2.0 over stdio, with the same message shapes over HTTP/WebSocket for remote hosts.
  - Define it in **JSON Schema 2020-12** (to match MCP's schema dialect).\[72\] Author it in TypeScript and emit schemas, or author it in **TypeSpec** and emit both JSON Schema and OpenAPI 3.1. AsyncAPI 3 documents the event stream.
  - **Recommendation:** TypeSpec as source of truth. It is MIT and Microsoft-maintained (this report did not re-verify its version this cycle).
  - **Overturn if** the team prefers zod-first; then generate JSON Schema from zod.
- **Rust client** (`atk-host` crate):
  - Generate *wire types* from the schema using a deliberately constrained subset: no `prefixItems`, `$dynamicRef`, or external `$ref`. typify 0.8.0 handles that reliably even though it is Draft-7-centric.\[1\]
  - Hand-write the transport/client (tokio, serde).
  - Do not use progenitor while it remains OpenAPI-3.0.x-only and the protocol is not REST-shaped.\[73\]
  - Use schemars 1.x on the Rust side only if typify's ^0.8 pin is not in the same crate graph.\[54\] Otherwise use serde-derived types + a schema snapshot test.
  - **Overturn if** typify 2 (in development, May 2026) ships with 2020-12 support.\[1\]
- Ports: `StoragePort` (answers/submissions durable store, owned by the Rust host), `EventPort` (submission → agent delivery), `IdentityPort`, `AddressingPort` (URLs/tunnels), `TrustedControlPort` (host-rendered buttons/confirmations).

### 3.4 Harness plugins

| Harness | Manifest | Skills location | Install |
|---|---|---|---|
| Claude Code | `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` | `skills/` | `claude plugin marketplace add org/atk` |
| Codex | `.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json` (also reads Claude-style marketplace) | `skills/` (does **not** follow symlinks) | `codex plugin marketplace add org/atk` |
| Gemini CLI | `gemini-extension.json` | `skills/` at extension root | `gemini extensions install <repo>` |
| Cursor | `.cursor-plugin/plugin.json` + marketplace | `skills/` | marketplace |
| GitHub Copilot CLI / VS Code | `.github/plugin/marketplace.json` | `skills/` | marketplace |

Each plugin bundles the same three things: the skill, the MCP server config (`npx -y @atk/cli mcp`), and optional hooks (e.g., run `atk verify` on Stop). Keep a single `plugins/` source and generate the per-harness manifests in CI. A real-world repo (cerbos/skills, Oct 7 2026) hit exactly these pitfalls: Codex ignoring symlinked skill dirs, and Gemini reading only a root `skills/`.\[74\]

---

## 4. Engineering Blueprint for the Repository

### 4.1 Tooling choices — comparison and ranking

| Decision | Choice | Alternatives | Why / overturn if |
|---|---|---|---|
| Package manager | **pnpm 11** (catalogs, strict deps); trial **pnpm 12** in a CI matrix | Bun, npm workspaces | 11 is `latest` and supported to Apr 2027. 12 is stable but not yet `latest`.\[35\]\[75\] Move to 12 once it becomes npm `latest`. |
| Task runner | **Turborepo 2.x** (MIT since 2.0; v2.11.3 Sept 2026) | Nx 22/23 (MIT core, Nx Cloud paid tier with a free 50k-credit hobby plan), moon\[76\] | Fewer concepts and enough for a ~15-package JS repo. Overturn if we need distributed CI, module-boundary enforcement or polyglot (Rust) task graphs at scale; then Nx.\[77\] |
| Versioning | **Changesets** | Nx Release, release-please | Changesets is the de-facto standard with Turborepo/pnpm and gives contributor-authored intent files. Overturn if we adopt Nx.\[78\] |
| Library build | **tsdown** (Rolldown/Oxc, tsup-compatible, built-in attw/publint integration; needs Node ≥22.18 at build time)\[79\]\[80\]\[81\]\[82\] | tsup (maintenance mode in practice), unbuild | Fast dts, ESM-first. Overturn if Rolldown regressions hit dts emission; tsup is the fallback. |
| Type checker | **TypeScript 7.0.x** (`tsc`, Go-native) plus pinned **6.0.x** for API-consuming tools | — | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedDeclarations` (fast dts). |
| Unit/component tests | **Vitest 4.1.8+** (Browser Mode via `@vitest/browser-playwright`) | Jest | Real-browser component tests and screenshots in one runner. |
| E2E/verify | **Playwright Test 1.6x** | Cypress | Same engine as `atk verify` (dogfooding). |
| Visual regression | **Playwright/Vitest snapshots in-repo** (Linux Docker baseline); add **Argos** (OSS-friendly SaaS) for PR review UI | Chromatic (Storybook-centric, paid), Lost Pixel (OSS + SaaS) | Pricing and licensing for SaaS options were not re-verified this cycle. Pick on review UX and OSS plan at adoption time. |
| API surface | **API Extractor** (needs TS JS API → run on TS 6.0.x), **@arethetypeswrong/cli**, **publint** | — | Gate PRs on `.api.md` diffs. |
| Publishing | **npm trusted publishing (OIDC)** + provenance; `id-token: write`; npm ≥11.5.1\[83\]\[84\] | Tokens | Tokens are being restricted; OIDC avoids secrets.\[85\] |
| Lint/format | ESLint (typescript-eslint) or Biome/Oxlint; Prettier or Biome | — | Judgment: Biome/Oxlint for speed + ESLint only for React-hooks rules. |

### 4.2 Proposed repo layout

```
atk/
├── AGENTS.md  CLAUDE.md → imports AGENTS.md   README.md  LICENSE (Apache-2.0)  NOTICE
├── SECURITY.md  CONTRIBUTING.md (DCO)  GOVERNANCE.md  CODE_OF_CONDUCT.md  MAINTAINERS.md
├── pnpm-workspace.yaml (catalogs)  turbo.json  .changeset/  tsconfig.base.json
├── protocol/                    # language-neutral source of truth
│   ├── spec/  (TypeSpec → JSON Schema 2020-12 + OpenAPI 3.1 + AsyncAPI)
│   ├── schemas/ (generated, committed, versioned by protocol date e.g. 2027-01-15)
│   └── conformance/             # host conformance kit (scenarios, fixtures, runner)
├── packages/
│   ├── core/          # artifact model, ports interfaces, diagnostics schema
│   ├── react/         # components, hooks, theme ("beautiful by default")
│   ├── server/        # local server: build (Vite/Rolldown), HMR, actions, persistence via ports, security middleware
│   ├── verify/        # Playwright pipeline, axe, screenshots, smoke tests, diff
│   ├── tui/           # PTY + xterm.js bridge + buffer snapshots
│   ├── cli/           # `atk` binary
│   ├── mcp/           # MCP server (2026-07-28) + MCP Apps viewer
│   ├── sdk/           # embeddable TS SDK for hosts
│   └── create/        # templates (`atk new`)
├── crates/
│   ├── atk-protocol/  # generated wire types (typify on constrained subset)
│   └── atk-host/      # Rust client + conformance adapter
├── skills/artifact-toolkit/     # the Agent Skill (single source)
├── plugins/                     # manifest templates → generated per harness
├── templates/  examples/        # gallery; each example has a verify snapshot
├── apps/docs/                   # docs site built WITH atk (dogfood)
└── tests/ (e2e, visual baselines, perf benchmarks)
```

### 4.3 Testing strategy

- Unit (Vitest node), component (Vitest Browser Mode), e2e (Playwright).
- **Every example in `examples/` is a test**: `atk verify --json` must pass, and visual and ARIA baselines are committed.
- An "agent eval" suite runs nightly: a fixed set of prompts executed by 2–3 harnesses/models. It measures first-try verify pass rate, turns-to-pass and multi-turn retention (EvoGenUI-style). This is the KPI for ergonomics changes.
- Perf budget tests for verify latency.

### 4.4 Versioning, semver and conformance

- **Libraries:** semver via Changesets. The public API is defined by API Extractor reports, plus error codes, CLI flags/JSON output schemas, and config keys. Use 0.x until the host protocol freezes, and stay on 1.x for long periods afterwards.
- **Protocol:** date-versioned like MCP (`2027-01-15`), with additive changes within a revision. Breaking changes go into a new revision with a ≥12-month deprecation window, mirroring MCP's new policy.\[5\] Each message carries `protocolVersion`. Hosts and toolkit negotiate the highest common revision.
- **Conformance kit:** `npx @atk/conformance host --command "<host binary>"` runs scenarios against each port: storage durability across restart, submission delivery exactly-once/at-least-once semantics, identity propagation, addressing/URL rewriting, trusted-control round-trip, and security (rejects a bad Host/Origin, missing token).
  - It supports per-revision requirement sets, an expected-failures baseline file, and a GitHub Action.\[58\]\[59\]
  - It publishes host tiers (e.g., "Conformant 2027-01-15: 100% required scenarios").
  - The pattern copies the MCP conformance suite + SEP-1730. LSP, WPT and the OpenTelemetry spec compliance matrix are the long-standing models of the same idea.
  - The Rust harness is the first conformance target in CI.

### 4.5 Docs site: dogfood

**Recommendation:** build `apps/docs` with atk itself. MDX pages are artifacts; live examples are embedded artifacts; every page also emits `.md` plus `llms.txt`/`llms-full.txt`.
- Justification: this exercises presentations/MDX/live-data paths and proves "beautiful by default."
- Fallback if the docs needs outgrow the toolkit early (search, versioning, i18n): **Fumadocs** (React/Next, MIT) is the closest fit for a React toolkit. Starlight (Astro) and VitePress (Vue) are excellent but off-stack. Nextra is viable.
- **Overturn if** dogfooding delays the 1.0 docs. In that case ship Fumadocs and embed atk artifacts in it.

### 4.6 Security policy and localhost hygiene

- **Project security:**
  - `SECURITY.md` with GitHub private vulnerability reporting enabled and a 90-day disclosure policy.
  - OpenSSF Scorecard Action on main, aiming for the OpenSSF Best Practices "passing" badge in year one.
  - Pinned action SHAs, CodeQL, dependency review, Renovate with minimum release age (supply-chain cooldown).
  - OIDC-only publish with provenance, and 2FA-required org.
- **Local server hygiene** (in scope per brief; not content guardrails):
  1. Bind `127.0.0.1` by default. `--host` needs an explicit flag.
  2. **Host header allowlist** (`localhost`, `127.0.0.1`, `[::1]`, configured tunnel names) to defeat DNS rebinding.
  3. **Origin check** on every state-changing HTTP request and WebSocket upgrade. Reject cross-site `Sec-Fetch-Site`.
  4. **Per-launch random token**, delivered in the opened URL and exchanged for an `HttpOnly; SameSite=Strict` cookie. Required on actions, submissions and the HMR socket.
  5. No `Access-Control-Allow-Origin: *`. Set `Cross-Origin-Resource-Policy: same-origin` on all responses (webpack-dev-server added CORP after source-exposure advisories).\[86\]
  6. Robust header parsing (CVE-2026-14631-class DoS).
  7. For remote phone access: require the tunnel/VPN host to be explicitly registered via the AddressingPort, and require HTTPS or a token.
  8. Chrome's Private Network Access helps but is Chrome-only, so never rely on it.\[87\]
  9. The same controls apply to the MCP Streamable HTTP transport (cf. CVE-2025-66414).\[51\]

### 4.7 License and governance

| Option | Patent grant | Enterprise posture | Compatibility | Verdict |
|---|---|---|---|---|
| **Apache-2.0** | Explicit grant + patent-retaliation clause | Preferred by many corporate legal teams; used by Playwright, TypeScript and newer MCP repos for new contributions\[88\] | Compatible with GPLv3, not GPLv2 | **Recommended** |
| MIT | None explicit | Universally accepted, simplest | Maximal | Strong alternative |

- **Recommendation: Apache-2.0** for code. Use CC-BY-4.0 for docs if desired. Contributions come under **DCO** (sign-off), not a CLA. DCO is lighter for drive-by agent-assisted PRs and standard at Linux Foundation projects.
- **Reason:** a protocol + host ecosystem invites corporate implementers. An explicit patent grant lowers their legal friction and eases a later foundation donation.
- **Overturn if** the dominant React ecosystem consumers we target require MIT for bundling policies (rare). The license choice is not legal advice; confirm with counsel.
- **Governance path (judgment):**
  - Start as a **BDFL/core-maintainer model** with a written GOVERNANCE.md: maintainers list, lazy consensus, RFC process for protocol changes in `rfcs/`, and SEP-style numbered proposals.
  - Move to a **steering committee** once ≥3 organizations ship hosts.
  - Keep a **foundation** donation as the option for when hosts from competing vendors need neutrality. **AAIF** (Linux Foundation) is the most aligned home: MCP, AGENTS.md and goose live there, and its membership is broad.\[18\] OpenJS Foundation is the alternative for a JS-centric identity.
  - Trademark the name early so it can be transferred cleanly.

---

## Caveats

- Several adoption and token-efficiency figures come from secondary or single-source analyses: browser-MCP token counts, agent-browser savings, AGENTS.md project counts, llms.txt adoption cohorts. They are labeled as such and should be re-measured in our own CI.
- One secondary source says agentskills.io is "stewarded by the Agentic AI Foundation."\[15\] AAIF's own announcements list MCP, goose, AGENTS.md and agentgateway, not Agent Skills, so treat Skills' governance as Anthropic-originated open spec unless AAIF confirms otherwise.\[17\]\[18\]
- Version data moves fast. Release data for Nx conflicted across sources (22.7.x vs 23.x in Sept 2026).\[76\]\[89\] Playwright may have shipped past 1.62.1 by October. pnpm 12's `latest` tag status may have changed after early September. The MCP conformance package version (0.1.16 per a CDN mirror) and its license should be checked against the repo.\[90\]
- Visual-regression SaaS pricing (Argos, Chromatic, Lost Pixel), the OpenSSF Scorecard/Badge criteria, TypeSpec's current release, and Changesets' current release were not re-verified in this cycle. Verify them before committing.
- Latency targets in §2.2 are engineering goals. Screenshot token costs in §2.3 are computed from published formulas, not measured. Publish real benchmarks.
- Benchmarks such as EvoGenUI-Bench use LLM-as-judge evaluators. They indicate failure modes reliably, but their absolute scores should not be read as precise.

## Sources

1. [Typify 2 WIP: A better JSON Schema to Rust compiler](https://ahl.dtrace.org/2026/05/10/typify2-wip/)
2. [cargo-progenitor 0.14.0 - Docs.rs](https://docs.rs/crate/cargo-progenitor/latest)
3. [Releases · modelcontextprotocol/modelcontextprotocol](https://github.com/modelcontextprotocol/modelcontextprotocol/releases)
4. [The biggest MCP spec update ships July 28: What changes for AI agent authentication — WorkOS](https://workos.com/blog/mcp-2026-spec-agent-authentication)
5. [The 2026-07-28 Specification](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
6. [Claude supports MCP Apps, presents UI within chat window](https://theregister.com/2026/01/26/claude_mcp_apps_arrives)
7. [MCP Apps are here: Rendering interactive UIs in AI clients — WorkOS](https://workos.com/blog/2026-01-27-mcp-apps)
8. [MCP Apps: Interactive UIs Inside Claude and ChatGPT](https://www.corpusiq.io/docs/hermes/mcp/mcp-apps-interactive-ui)
9. [MCP Apps - Model Context Protocol](https://modelcontextprotocol.io/extensions/apps/overview)
10. [Add UI to your MCP server](https://developers.openai.com/plugins/build/chatgpt-ui)
11. [What Are Agent Skills and How To Use Them](https://strapi.io/blog/what-are-agent-skills-and-how-to-use-them)
12. [SKILL.md in 2026: Authoring, Portability, Security](https://niteagent.com/blog/agent-skills-skillmd-authoring-portability-security/)
13. [How to add skills support to your agent - Agent Skills](https://agentskills.io/client-implementation/adding-skills-support)
14. [Agent Skills Overview - Agent Skills](https://agentskills.io/home)
15. [Agent Skills Explained: SKILL.md Format and Adoption (2026)](https://atlan.com/know/ai-agent/ai-agent-skills/what-are-agent-skills/)
16. [Linux Foundation Announces the Formation of the Agentic AI Foundation (AAIF), Anchored by New Project Contributions Including Model Context Protocol (MCP), goose and AGENTS.md](https://www.linuxfoundation.org/press/linux-foundation-announces-the-formation-of-the-agentic-ai-foundation)
17. [What the AAIF Means for MCP and Agentic AI - Ginger Labs](https://gingerlabs.ai/blog/agentic-ai-foundation-aaif-mcp-future-of-agentic-ai)
18. [Agentic AI Foundation Welcomes 57 New Members, Gaining Major Financial Services Players and APAC Leaders](https://www.linuxfoundation.org/press/agentic-ai-foundation-welcomes-57-new-members-gaining-major-financial-services-players-and-apac-leaders)
19. [llms.txt in Practice: Adoption Data, Evidence, and Setup](https://www.digitalapplied.com/blog/llms-txt-in-practice-adoption-evidence-2026)
20. [The llms.txt Guide for 2026: What It Is, What It Isn't, and When to Bother — OpenHermit Blog](https://www.openhermit.com/blog/llms-txt-guide)
21. [LLMS.txt Adoption: 8.7% of the Top 1,000 (June 2026)](https://www.rankability.com/data/llms-txt-adoption/)
22. [Does anyone actually have an llms.txt? I checked millions of websites · Casey Burridge](https://caseyrb.com/blog/state-of-llms-txt-adoption/)
23. [llms.txt Explained (May 2026): The Honest Guide to the Spec, Adoption, and How to Ship One](https://codersera.com/blog/llms-txt-complete-guide-2026/)
24. [EvoGenUI-Bench: Evaluating LLMs as Multi-Turn Generative UI Assistants](https://arxiv.org/html/2608.29387v1)
25. [\[2507.04952\] ArtifactsBench: Bridging the Visual-Interactive Gap in LLM Code Generation Evaluation](https://arxiv.org/abs/2507.04952)
26. [Playwright (software)](<https://en.wikipedia.org/wiki/Playwright_(software)>)
27. [Release notes](https://playwright.dev/python/docs/release-notes)
28. [GitHub - qa-gary-parker/playwright-release-notes-examples: A comprehensive demonstration of new features and improvements in Playwright releases · GitHub](https://github.com/qa-gary-parker/playwright-release-notes-examples)
29. [Playwright 1.60: Drop API, HAR Tracing & Diagnostics](https://testdino.com/blog/playwright-1-60-release)
30. [Playwright MCP vs Playwright CLI (2026)](https://www.webfuse.com/blog/playwright-mcp-vs-playwright-cli)
31. [What does it cost to process an image with a vision model?](https://roboflow.com/blog/image-token-cost-vlm)
32. [Runnable TypeScript Docs: TypeScript 7](https://coddy.tech/docs/typescript/typescript-7)
33. [TypeScript 7.0 RC: Go Compiler 10x Faster \[2026\]](https://tech-insider.org/ie/typescript-7-native-compiler-2026/)
34. [TypeScript 7: the compiler moved to Go, what changed? - DevOpen](https://devopen.io/typescript-7/)
35. [pnpm](https://endoflife.date/pnpm)
36. [pnpm vs npm: 3x Faster Installs? \[2026\] Winner Revealed](https://tech-insider.org/pnpm-vs-npm-2026/)
37. [Releases · pnpm/pnpm](https://github.com/pnpm/pnpm/releases)
38. [What's different in pnpm 12](https://pnpm.io/blog/whats-different-in-pnpm-12)
39. [pnpm 12.0](https://pnpm.io/blog/releases/12.0)
40. [pnpm 12's Rust Rewrite Goes Stable, Cutting Repeat Installs to 15ms](https://xenospectrum.com/en/pnpm-12-rust-rewrite-stable-release/)
41. [pnpm 11.26](https://pnpm.io/blog/releases/11.26)
42. [Vitest 4.0 — Browser mode stable, visual regression and Playwright traces](https://progosling.com/en/dev-digest/vitest-4-browser-stable-visual-regression)
43. [vitest 4 browser mode](https://www.infoq.com/news/2025/12/vitest-4-browser-mode)
44. [Vitest (@vitest@webtoo.ls) - webtoo.ls](https://m.webtoo.ls/@vitest)
45. [npm trusted publishing with OIDC is generally available - GitHub Changelog](https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/)
46. [Migrate npm publishing to trusted publishing (OIDC) — token deprecation deadline · Issue #20 · Tempreon/memhaul](https://github.com/Tempreon/memhaul/issues/20)
47. [Move npm publishing to OIDC trusted publishing · Issue #226 · lid-labs/hevc.js](https://github.com/lid-labs/hevc.js/issues/226)
48. [Any websites were able to send any requests to the development server and read the response · Advisory · vitejs/vite · GitHub](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6)
49. [webpack-dev-server/middleware security issues](https://medium.com/webpack/webpack-dev-server-middleware-security-issues-1489d950874a)
50. [webpack-dev-server vulnerable to denial of service via a malformed Host or Origin header](https://github.com/webpack/webpack-dev-server/security/advisories/GHSA-m28w-2pqf-7qgj)
51. [DNS Rebinding: How a Browser Visits Your localhost](https://blogs.jsmon.sh/dns-rebinding-how-a-browser-visits-your-localhost/)
52. [Typify — Rust data encoding library // Lib.rs](https://lib.rs/crates/typify)
53. [chore(deps): bump typify from 0.7.0 to 0.8.0 by dependabot\[bot\] · Pull Request #123 · ribru17/gen-lsp-types](https://github.com/ribru17/gen-lsp-types/pull/123)
54. [build(rust)!: opentelemetry 0.33, schemars held at 0.8 for typify by 0x19 · Pull Request #170 · inorbithr/sdk](https://github.com/inorbithr/sdk/pull/170)
55. [Progenitor — Cargo library // Lib.rs](https://lib.rs/crates/progenitor)
56. [chore(deps): bump progenitor from 0.14.0 to 0.15.0 by dependabot\[bot\] · Pull Request #159 · Akuja-Inc/taskfast-cli](https://github.com/Akuja-Inc/taskfast-cli/pull/159)
57. [Releases · GREsau/schemars](https://github.com/gresau/schemars/releases)
58. [GitHub - CaitieM20/conformance: Conformance Tests for MCP · GitHub](https://github.com/CaitieM20/conformance)
59. [GitHub - modelcontextprotocol/conformance: Conformance Tests for MCP · GitHub](https://github.com/modelcontextprotocol/conformance)
60. [SEP-1730: SDKs Tiering System - Model Context Protocol](https://modelcontextprotocol.io/seps/1730-sdks-tiering-system)
61. [SEP-1730: SDKs Tiering System · Issue #1730 · modelcontextprotocol/modelcontextprotocol](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1730)
62. [SEP-3405: Conformance-Driven SDK Tiers by felixweinberger · Pull Request #3405 · modelcontextprotocol/modelcontextprotocol](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/3405)
63. [Improving User Interface Generation Models from Designer Feedback](https://arxiv.org/html/2509.16779)
64. [GUIDE: Designer-in-the-loop Authoring of Conformant Generative User Interfaces](https://arxiv.org/pdf/2609.21285)
65. [1D-Bench: A Benchmark for Iterative UI Code Generation with Visual Feedback in Real-World](https://arxiv.org/pdf/2602.18548)
66. [UI2Code^"N": A Visual Language Model for Test-Time Scalable Interactive UI-to-Code Generation](https://arxiv.org/html/2511.08195v2)
67. [llms.txt Explained: The Spec, Real Adoption, and 2026 Data](https://macmdviewer.com/blog/llms-txt-guide)
68. [tsdown - The Elegant Bundler for Libraries](https://tsdown.dev/)
69. [Chrome DevTools MCP vs Playwright MCP for Digital Analysts: A Practical Comparison (2026)](https://www.trackingplan.com/blog/chrome-devtools-mcp-vs-playwright-mcp-digital-analysts)
70. [Playwright MCP vs Chrome MCP vs Stagehand Compared - qtrl](https://qtrl.ai/blog/mcp-cli-tools-ai-test-automation)
71. [Anthropic MCP Apps: Interactive UIs Inside Claude](https://www.digitalapplied.com/blog/anthropic-mcp-apps-interactive-ui-claude-guide)
72. [SEP-1613: Establish JSON Schema 2020-12 as Default Dialect for MCP - Model Context Protocol](https://modelcontextprotocol.io/seps/1613-establish-json-schema-2020-12-as-default-dialect-f)
73. [GitHub - oxidecomputer/progenitor: An OpenAPI client generator · GitHub](https://github.com/oxidecomputer/progenitor)
74. [Publish the skills as a plugin marketplace for Claude Code, Codex, Copilot, Cursor and Gemini by alexolivier · Pull Request #12 · cerbos/skills](https://github.com/cerbos/skills/pull/12)
75. [pnpm 12.0](https://daily.dev/posts/pnpm-12-0-8rg6jtt35)
76. [Turborepo vs Nx: Best Monorepo Tools 2026](https://devtoollab.com/blog/best-monorepo-management-tools)
77. [Turborepo versus Nx, Bazel, Lerna, and Friends](https://stevekinney.com/courses/enterprise-ui/turborepo-versus-nx)
78. [Nx vs Turborepo](https://nx.dev/docs/guides/adopting-nx/nx-vs-turborepo)
79. [Introduction - The Elegant Bundler for Libraries](https://tsdown.dev/guide/)
80. [tsdown, the elegant bundler for libraries powered by Rolldown](https://thinkthroo.com/blog/tsdown-the-elegant-bundler-for-libraries-powered-by-rolldown)
81. [TSDOWN - Fast Bundling for TypeScript and JavaScript Libraries](https://www.getclaudeskills.com/skills/tsdown-rolldown)
82. [GitHub - rolldown/tsdown: The elegant bundler for libraries powered by Rolldown · GitHub](https://github.com/rolldown/tsdown)
83. [Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers/)
84. [Things you need to do for npm trusted publishing to work](https://philna.sh/blog/2026/01/28/trusted-publishing-npm/)
85. [Publishing to npm](https://buildwithfern.com/learn/sdks/generators/typescript/publishing)
86. [Update dependency webpack-dev-server to v5 \[SECURITY\] by renovate-bot · Pull Request #37 · X-oss-byte/Hotel](https://github.com/X-oss-byte/Hotel/pull/37)
87. [Issue · microsoft/webui](https://github.com/microsoft/webui/issues/553)
88. [\# MCP TypeScript SDK](https://glama.ai/mcp/servers/@ayyappachinpandi/MCP-Example-ayyappa/blob/274fa5ad110d9e275a0709e029150a4360a44019/typescriptsdk.md)
89. [Turborepo vs Nx vs Lerna 2026: Monorepo Tool Comparison](https://tech-insider.org/turborepo-vs-nx-vs-lerna-2026/)
90. [@modelcontextprotocol/conformance CDN by jsDelivr - A CDN for npm and GitHub](https://www.jsdelivr.com/package/npm/@modelcontextprotocol/conformance)
