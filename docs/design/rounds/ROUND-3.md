# Round 3: kit, demos, extensions, packages and repository standards

**Status:** Design input for the third C03-A decision round. Mirza delegated most shapes in rounds 1 and 2; this document records the shapes C03-A proposes, with the alternatives considered, so he can veto any of them. Items that need his decision are collected in [§12](#12-questions-for-mirza). Code is illustrative.

---

## 1. Kit and design system

### 1.1 Components resolve without copying, and copy when edited

Every artifact uses one shadcn base (D27). Imports of `@/components/ui/<name>` resolve in this order:
1. the artifact's own `components/ui/<name>.tsx`, if it exists;
2. otherwise the kit's pinned copy of that registry item for the artifact's base, served as a read-only virtual module.

So a single `page.tsx` can import `@/components/ui/button` with nothing installed, and `mostra add button` (or `npx shadcn add button`, since packs are shadcn-compatible) copies the source into the artifact for editing. The copied file then wins. This answers ARCHITECTURE §6's "how kit packages are declared so that copy-source packs and the warm set don't diverge": the same pinned registry items feed both paths, versioned with the kit, and the kit version is part of version identity (VR-01).

*Alternative rejected:* `mostra new` always copies every component into the artifact. That gives 61 files of noise, slower verify, and agents editing components by accident.

The manifest chooses the base: `defineArtifact({ kit: { base: "base" | "radix" } })`. The default comes from the evaluation (KT1, in progress). `verify` turns the TS2322 shape observed for cross-base idioms into `MOSTRA_KIT_WRONG_BASE`, with the correct idiom as a machine-applicable fix (VERIFIED_FACTS, kit components).

### 1.2 Warm set and on-demand libraries

Warm means preinstalled in the runtime bundle's store and pre-optimized. Only what an artifact imports gets bundled, so being warm costs disk space, not page weight.

| Warm | On demand (installed on first import, then cached, D43) |
|---|---|
| React 19.3, React Router 8, Tailwind 4.3, `cn`, lucide-react, the shadcn component dependencies (radix-ui, @base-ui/react, cmdk, vaul, sonner, embla-carousel, react-day-picker, react-resizable-panels, input-otp), Recharts 3, uPlot, ECharts 6, TanStack Table 9, react-hook-form, Zod 4, Motion 14, Mermaid 12, @xyflow/react 12, Shiki 4, CodeMirror 6, KaTeX, MDX 3, xterm.js 6 | MapLibre, deck.gl, three, @react-three/fiber, drei, Excalidraw |

The on-demand group is large: three plus deck.gl plus Excalidraw would add tens of megabytes to every runtime bundle. Each is documented and themed in the kit like the warm ones. Version-churn guidance (D48) covers TanStack Table 9, Base UI's `render` prop, Tailwind 4 `@theme`, Zod 4 formats, `motion/react`, `@xyflow/react`, Mermaid 12 and the `cn` package.

### 1.3 One token system

shadcn's OKLCH CSS variables are the source. Mostra maps them one to one onto the MCP Apps `--color-*`, `--font-*` and `--border-radius-*` variables. Inline in a chat host, the host's values flow in; in Mostra's shell, a host brand theme arrives the same way (through the bridge's host-context message). Charts (`--chart-1..5`), uPlot and ECharts wrappers, Shiki and CodeMirror themes, the terminal theme and map styles all read the same variables. Dark mode is a `.dark` class driven by `prefers-color-scheme`, overridable by the viewer and the host.

### 1.4 Questionnaire and forms (KT3)

Built on shadcn's Questionnaire primitive (`@shadcn/react`, MIT) with its controlled props bound to fields (D52). Mostra adds ranking, scales, per-item comments, a recommended option, sections, required-answer blockers and labels in results.

```tsx
import { Questionnaire, Section, Question, Choice, Other, Scale, Rank, TextAnswer } from "@mostra/kit/questionnaire";

<Questionnaire id="intake" title="Sidebar redesign" mode="steps"> {/* or mode="page" */}
  <Section title="Layout">
    <Question id="layout" title="Which layout fits best?" required comments>
      <Choice value="left" recommended description="Matches the current IA">Left rail</Choice>
      <Choice value="top">Top bar</Choice>
      <Other />
    </Question>
    <Question id="density" title="How dense?"><Scale min={1} max={5} labels={["Airy", "Dense"]} /></Question>
    <Question id="priorities" title="Order these"><Rank items={["Search", "Recents", "Pins"]} /></Question>
  </Section>
  <Question id="notes" title="Anything else?"><TextAnswer /></Question>
</Questionnaire>
```

Each answer is the field `intake.<questionId>` (comments: `intake.<questionId>.comment`). Results show the label, the answer, the recommended option and whether the viewer picked it. Everything is ordinary React the agent can replace.

---

## 2. Review sets (D23)

```tsx
import { ReviewSet, Candidate } from "@mostra/kit/review";

<ReviewSet id="sidebar" layout="compare" choose> {/* layout: gallery | focus | compare */}
  <Candidate id="dense" label="Dense"><SidebarDense /></Candidate>
  <Candidate id="airy" label="Airy"><SidebarAiry /></Candidate>
  <Candidate id="web" label="Live app"><WebDemo demo="app" path="/settings" /></Candidate>
</ReviewSet>
```

- Candidates are surfaces inside the artifact. The kit lays them out (gallery, focus, or two to four synchronized side by side with optional pixel diff) and registers each surface with the shell, so comments record `reviewSetId` and `candidateId`.
- **Choose** is a trusted control: the artifact requests it, and the shell renders "Choose Dense" outside agent code (D06). Under a host that allows the artifact channel (D40), `useChoice("sidebar")` can choose from inside the page too, and the choice records its channel.
- The choice is the field `review.sidebar.choice` in the draft and arrives with the submission (RV-03).
- Candidates that are separate artifacts or versions use `<Candidate artifact="…" version="…" />`. The shell then shows them in sibling iframes on their own origins.

---

## 3. Motion composition primitive (KT4)

The shape agents know from Remotion, with Mostra's own names and no Remotion dependency (D26). Frames are the only clock, so screenshots are deterministic.

```tsx
import { Timeline, Clip, useFrame, interpolate, spring } from "@mostra/kit/motion";

<Timeline fps={30} duration="6s" loop controls poster="2s"> {/* play, pause, scrub, loop */}
  <Clip from="0s" to="2.5s"><Title /></Clip>
  <Clip from="2s"><RevenueChart /></Clip>
</Timeline>

function Title() {
  const { frame, fps } = useFrame();            // frame is relative to the enclosing Clip
  const opacity = interpolate(frame, [0, 15], [0, 1], { clamp: true });
  const y = spring({ frame, fps, from: 24, to: 0 });
  return <h1 style={{ opacity, transform: `translateY(${y}px)` }}>Q3 in one minute</h1>;
}
```

- `verify` renders the poster frame and the frames listed in `verify.frames`. Reduced motion shows the poster.
- Review comments on a timeline anchor to time plus region (D23).
- Name check: `Timeline`, `Clip` and `useFrame` avoid Remotion's `Composition`, `Sequence`, `useCurrentFrame` and `AbsoluteFill`. `interpolate` and `spring` are generic animation terms used across libraries.
- Motion (the library) stays the tool for UI animation.

---

## 4. Decks (KT5)

An MDX entry with `deck` frontmatter is a deck. The grammar follows Slidev:

````mdx
---
title: What shipped this week
deck: { aspect: "16:9" }
layout: cover
---

# What shipped this week

---
layout: two-cols
---

## Before and after

<Click>The old sidebar…</Click>
<Click>…and the new one</Click>

::right::

<WebDemo demo="app" device="iphone-15" />

```ts {2,4}
const x = 1
const y = 2
```

<Notes>Mention the a11y fixes.</Notes>
````

- `---` separates slides; slide frontmatter sets `layout` (cover, default, section, two-cols, image-right, code, chart, quote); `::right::` names a layout slot.
- `<Click>` and `<Clicks>` give click steps; `<Notes>` holds speaker notes.
- Shiki code blocks with line highlights, `$…$` KaTeX, Mermaid fences, `<Timeline>` and `<WebDemo>` all work inside slides.
- Presenter view in a second window over BroadcastChannel; print to PDF through CSS `@page`.
- The current slide and step are reported to the shell, so comments anchor to them.

---

## 5. Terminals (TM1, TM3) and web demos (TM-08, RV1)

### 5.1 Components

```tsx
import { Terminal, TerminalCompare } from "@mostra/kit/terminal";

<Terminal src="./demo.cast" />                       // recording (asciicast v3), owned renderer
<Terminal frames="./captures/sidebar-a.json" />      // ratatui capture crate output
<Terminal session="htop" />                          // live PTY, declared in the manifest
<Terminal wasm="./tui-web/pkg" />                    // Ratzilla iframe island
<TerminalCompare sync="step">{/* two to four terminals, cell diff */}</TerminalCompare>
```

Live sessions are **declared**, never sent from the page: `defineArtifact({ terminals: { htop: { command: ["htop"], cwd: ".", cols: 120, rows: 36, input: true } } })`. The page asks for a session by name, and the worker spawns it through the `pty` port. This follows brief 4's hygiene advice (spawn only from registered specs, never from URL parameters). It doesn't limit the agent, who writes the manifest. Sessions are read-only unless `input: true`. Every live session is teed into an asciicast v3 recording.

### 5.2 Frame model

```ts
type Cell = { t: string; w: 0 | 1 | 2; fg?: Color; bg?: Color; ul?: Color; a?: number /* bold dim italic underline-style blink inverse hidden strike */; link?: number };
type Color = { i: number } | { rgb: string /* "#rrggbb" */ };
type Frame = { cols: number; rows: number; cells: Cell[] /* row-major; w=0 marks a wide tail */;
               cursor?: { x: number; y: number; visible: boolean; shape?: "block" | "bar" | "underline" };
               alt: boolean; t: number /* ms */; seq: number; key: boolean /* keyframe */ };
type Recording = { header: { cols: number; rows: number; theme: Theme; widthTable: "unicode11"; source: "pty" | "asciicast" | "ratatui" | "wasm" };
                   frames: (Frame | FrameDiff)[]; markers: { t: number; label: string }[] };
```

The schema lives in `@mostra/protocol` (Zod, with JSON Schema output), so the TypeScript renderer, `mostra term dump` and the Rust capture crate share it. Byte streams go through `@xterm/headless` with Unicode 11 widths. ratatui captures take widths from ratatui's buffer (VERIFIED_FACTS, terminal fixtures).

### 5.3 PTY

`node-pty` 1.1.0 runs in one PTY host process per home, isolated from the supervisor, behind the `pty` port (D58), so a host can supply PTYs instead. ghostty-web stays on the watch list behind the embed-engine contract.

### 5.4 Web demos

```ts
defineArtifact({
  demos: {
    app: { command: ["pnpm", "dev", "--port", "{port}"], cwd: "../web", ready: "/" }, // Mostra starts it
    docs: { attach: 5173 },                                                          // already running
  },
});
```

`<WebDemo demo="app" path="/settings" device="iphone-15" />` embeds it. The gateway proxies the dev server on its own leased port origin (D38), passing HTTP and WebSocket traffic through, rewriting `Host` where needed, and stripping framing headers only from that demo's responses.

**Bridge injection (RV1):** HTML responses from proxied demos get a small review-bridge script by default, so comments resolve to elements inside the demo. `bridge: false` turns it off for apps whose CSP or integrity checks reject it. Without the bridge, comments fall back to coordinates and screenshot crops (D23).

---

## 6. Extensions (EX1 to EX3)

### 6.1 v1 contracts

Each contract is its own package at 0.x (D30), with a `define*` blueprint that stamps the contract identity:

| Package | Contract | First-party proof in v1 |
|---|---|---|
| `@mostra/contract-embed-engine` | `mount`, `resize`, `snapshot`, `dispose`, `capabilities` | xterm.js terminal engine; Remotion adapter; GSAP adapter |
| `@mostra/contract-exporter` | `export(version, options) → files` with a declared output type | MCP App exporter (static, HTML and bundle exports are built in) |
| `@mostra/contract-verify-check` | `run(context) → diagnostics` | terminal lint |
| `@mostra/contract-anchor-provider` | `serialize(selection)`, `resolve(anchor)` | chart datum anchors |
| `@mostra/contract-connector` | `schema`, `read`, `subscribe`, optional `write`, feeding live sources | a filesystem/JSON connector |
| `@mostra/contract-cli-command` | name, args schema, handler, JSON output | `mostra term record` |

Host adapters are the protocol ports themselves (D58), proven by the conformance kit, so they need no extra contract package. Render modes stay an internal contract in v1 (§7).

### 6.2 Manifest

The `"mostra"` key in `package.json`, as in brief 8, validated by `mostra plugin validate`. Fields:
- `name` (namespace), `contracts` (ranges per contract);
- `contributes` (engines, exporters, checks, anchor providers, connectors, commands, source packs);
- `effects`, declared and never enforced;
- `license`, an SPDX expression, plus `bundledLicenses` with a license class;
- `skills`, `examples` with `baselines`, and `platforms`.

### 6.3 Packs

A pack item is a shadcn `registry-item.json` plus an optional `mostra` block (base variants, field IDs it introduces, verify baselines). Any shadcn item installs unchanged (EX-03).

### 6.4 Loading and conflicts

- Plugins are recorded per artifact in its lockfile; CLI commands and exporters may also be installed per home.
- Load order is the declaration order.
- Two plugins contributing the same ID is an error that names both. Nothing is silently overridden.
- A contract range the core doesn't implement is a diagnostic at install and at load.
- License acknowledgment follows D31 (`--accept-license <id>`, recorded in the lockfile; hosts may pre-accept).

---

## 7. Render mode contract (RD1)

Internal in v1. SPA is the only implementation, and an `rsc` mode implements the same interface later (D19):

```ts
interface RenderMode {
  readonly id: "spa" | "rsc";
  capabilities(manifest: Manifest): { staticExport: boolean; mcpApp: boolean; needsWorker: boolean };
  build(input: BuildInput): Promise<BuildOutput>;    // client assets, optional server bundle, field and action registry
  dev(input: DevInput): Promise<DevSession>;         // `mostra dev` only (VR-08)
  serverEntry(output: BuildOutput): WorkerEntry;     // what a worker loads to serve server functions
}
```

---

## 8. Shell and bridge (SH1)

The bridge is JSON-RPC 2.0 over `postMessage`, with exact origin checks and schema validation. It uses MCP Apps names wherever the concept exists, so MCP App export only swaps the transport (SH-04).

| Direction | Messages |
|---|---|
| Artifact → shell | `ui/initialize` (capabilities), `mostra/ready` (verify's readiness signal), `ui/notifications/size-changed`, `mostra/page`, `mostra/surfaces` (review surfaces and candidates), `mostra/fields` (registry for blockers and labels), `mostra/controls.request` (submit label, choose), `ui/open-link` |
| Shell → artifact | `ui/notifications/host-context-changed` (theme, locale, display), `mostra/review.hitTest`, `mostra/review.resolve`, `mostra/review.scrollTo`, `mostra/field.focus`, `mostra/version.available` |

**Host-replaceable shell.** The shell's chrome follows the tokens, so hosts can theme it. A host that wants its own shell (say, a desktop app) implements the same bridge protocol and gets the same guarantees. The bridge is versioned with the host protocol, and the conformance kit includes shell scenarios.

**Visual design** (SH-05) is round 4. I'll build a shell prototype for you to review in the browser.

---

## 9. `verify` details (VF1)

- **Diagnostic codes:** `MOSTRA_<AREA>_<NAME>`. The areas are `MANIFEST`, `BUILD`, `TYPE`, `LINT`, `DEP`, `KIT`, `FIELD`, `ACTION`, `LIVE`, `RUNTIME`, `CONSOLE`, `NETWORK`, `A11Y`, `VISUAL`, `SMOKE`, `REGRESSION`, `TERM`, `PUBLISH`, `HOST`, `HYGIENE` and `PLATFORM`. Each code has a docs page with a minimal fix. Codes are semver surface (AX-03).
- **Smoke test:** opens every popup trigger, clicks every enabled control, fills fields from their validators and input types, flips slides and steps timelines. Actions follow D55. Links to other origins are recorded, not followed. The budget is 200 interactions or 60 s.
- **Regression baseline:** the last version of the same artifact that passed `verify`. It compares the ARIA snapshot, pixels per viewport (perceptual threshold) and contracts (field IDs, actions, required fields, review sets). A field that disappears is a warning that names the orphan it will create (D42).
- **Viewports:** 1280×800 and 390×844 at DPR 1. Tablet, dark theme and other browsers are opt-in.
- **Browser:** a warm Playwright Chromium headless shell owned by the daemon. Each verify gets a fresh context, and the browser closes after 10 idle minutes.

## 10. Harness plugins and MCP Apps conformance (VF2, MC3)

- **Harness plugins.** One `skills/mostra/` source and one plugin definition. CI generates the Claude Code, Codex, Gemini CLI, Cursor and Copilot manifests as real copies, never symlinks (Codex doesn't follow them, and Gemini reads only a root `skills/`). Each bundles the Skill and the MCP configuration (`npx -y @mostra/cli mcp`).
- **MCP Apps conformance in v1:**
  - automated tests against the ext-apps reference host in CI;
  - external evidence from Claude Desktop and VS Code, which can reach the local server;
  - ChatGPT and claude.ai need a public server and move with remote mode to v1.x.

---

## 11. Packages, repository standards and publication

### 11.1 Package map (PK1): two candidates

**P1: one package per subsystem** (the seed's §19 starting point). About 20 packages: core, supervisor, gateway, worker, builder, interaction, client, react, kit, terminal, proxy, verify, cli, mcp, sdk, create, and contracts.

**P2: packages by audience and isolation boundary (recommended).** A package exists where an independent consumer imports it, or where a process boundary must not be crossed:

| Package | Audience | Contents |
|---|---|---|
| `@mostra/react` | artifact authors (browser) | client runtime, hooks, `window.storage`, bridge client, transports (SSE, long-poll, MCP Apps); RSC-safe |
| `@mostra/server` | artifact authors (worker) | server context helpers, `defineLive` |
| `@mostra/kit` | artifact authors | `/questionnaire`, `/review`, `/motion`, `/deck`, `/terminal`, `/charts`, `/demo` subpaths, plus the per-base registry items |
| `@mostra/protocol` | every client and host | Zod schemas for the host protocol, bridge, diagnostics, terminal frames and manifest; generated JSON Schema |
| `@mostra/sdk` | JavaScript hosts | `createMostra({ home, ports })`, runtime-bundle management |
| `@mostra/cli` | agents, people | the `mostra` binary, including `mostra mcp`; a thin protocol client |
| `create-mostra` | people | `npm create mostra` |
| `@mostra/conformance` | host authors | scenarios, runner, expected-failure baselines |
| `@mostra/contract-*` | plugin authors | one package per contract (D30) |
| `@mostra/runtime` | the runtime bundle | supervisor, gateway, interaction ledger, builder, dependency store, addressing, shell server; one deep module per concern inside |
| `@mostra/worker` | the runtime bundle | the worker process entry; never imports the runtime |
| `@mostra/verify` | the runtime bundle | the Playwright pipeline (the heavy dependency stays separate) |
| `@mostra/shell` | the runtime bundle | the trusted shell web app |
| `@mostra/pty-host` | the runtime bundle | the node-pty process |
| crates `mostra-host`, `mostra-term-capture` | Rust hosts; ratatui authors | wire types, client, bundle management, port traits; capture |

P2 wins on depth. P1 splits gateway, proxy, supervisor and builder by execution stage, so their callers coordinate stages and share internal types (temporal decomposition, information leakage). P2 keeps those as modules behind one runtime interface and puts package boundaries only where they enforce something: the browser/worker/supervisor process lines, the heavy Playwright dependency, and independently versioned contracts. Authors import from three places (`@mostra/react`, `@mostra/server`, `@mostra/kit/*`) plus their `@/components/ui`.

Repository layout:

```text
mostra/
  AGENTS.md  README.md  LICENSE  NOTICE  SECURITY.md  CONTRIBUTING.md  GOVERNANCE.md  CODE_OF_CONDUCT.md
  docs/design/  docs/progress/  docs/research/  docs/agents/        # playbooks for recurring tasks
  packages/  crates/  plugins/  skills/mostra/  templates/  examples/  apps/docs/  tests/  tools/
```

### 11.2 Repository standards (D50)

**Toolchain:**
- pnpm 12 workspaces with catalogs; Turborepo with local and CI caches; Changesets; tsdown.
- TypeScript 7 `tsc` with STANDARDS' strict flags and project references, so the language server works across packages; TypeScript 6 for API Extractor.
- Biome for formatting and linting, plus ESLint only for React hooks rules.
- Vitest 5 (unit and browser mode) and Playwright Test (end-to-end on Chromium, Firefox and WebKit).
- Rust: `rustfmt`, `clippy -D warnings`, `cargo-nextest`, `cargo-deny`.

**Code quality gates,** all mechanical:
- package-boundary rules (for example, the worker never imports the runtime, and `@mostra/react` never imports Node built-ins), enforced by dependency-cruiser;
- unused exports and dependencies (knip);
- API Extractor reports, publint and are-the-types-wrong;
- size budgets for `@mostra/react` (size-limit);
- the license audit (OSI-only core, `pnpr/` excluded) and `cargo-deny`;
- every example and template passing `mostra verify`, with committed visual and ARIA baselines;
- the conformance kit against the standalone adapters and a reference host.

**CI (GitHub Actions, actions pinned by SHA):**
- An affected-change job computes the work.
- Independent jobs run in parallel: format and lint; type check; unit (sharded); build; end-to-end per browser (matrix); Rust; license and dependency audit; API reports; docs build; examples verify (sharded); conformance.
- macOS and Linux run wherever behavior is platform-specific.
- Concurrency groups cancel superseded runs. pnpm, Turborepo, Playwright and cargo caches are shared.
- Target: under 10 minutes wall-clock for a typical pull request.
- Supply chain: CodeQL, dependency review, Renovate with a minimum release age, OpenSSF Scorecard, secret scanning.

**Local workflow:**
- `pnpm check` runs exactly the CI gates through Turborepo, in parallel; `pnpm check --affected` runs them for the change.
- lefthook: pre-commit formats and lints staged files (seconds); commit-msg checks the commit format and DCO sign-off; pre-push runs affected tests.

**Commits and pull requests:**
- Conventional Commits with the package as scope, signed off (DCO, enforced in CI), one coherent change each.
- Changesets record release intent. One branch per WP.
- The pull request template lists the requirement IDs touched, the evidence (checks run, what was not run and why) and screenshots for visible changes.
- CODEOWNERS; required checks; merge commits (no rewriting history, STANDARDS).

**Documentation for workers:**
- Root `AGENTS.md`: commands, conventions, where to read what, the D49 working agreements and compaction guidance.
- Each package has a short `AGENTS.md` (local rules, invariants it owns, tests to run) and a `README.md` for humans.
- `docs/agents/` holds playbooks for recurring work: add a diagnostic code, a protocol method, a kit component, a contract, a template.
- Each WP specification lists its required reading, erring towards more.
- Reference material (CLI help, the diagnostic catalog, API reports, protocol schemas) is generated from source, never hand-copied.

### 11.3 Publication pipeline

- **Changesets** opens a release pull request. Merging it publishes from a protected GitHub environment:
  - npm through trusted publishing (provenance automatic);
  - crates.io through `crates-io-auth-action`;
  - runtime bundles per platform (macOS arm64 and x64, Linux x64 and arm64), each with a SHA-256 manifest and a GitHub artifact attestation, attached to the GitHub release;
  - the docs site to GitHub Pages (D37).
- **One-time account steps for you:**
  - create the npm organization;
  - configure a trusted publisher per package (npm requires this per package, and a new configuration must publish within 2 days);
  - possibly create one crates.io token per crate for its first release (VERIFIED_FACTS, publishing).
- Package settings: "Require two-factor authentication and disallow tokens". The open choice is Q2 below.

---

## 12. Questions for Mirza

1. **Long-lived artifacts (D63).** Confirm the additions: artifact-scoped state writable by viewers and agents, submission policy `none`, "Always follow this artifact", live updates without durable events, non-expiring local capability URLs, the always-on daemon, and journeys J11 and J12.
2. **npm release approval.**
   - *Direct.* The trusted publisher may run `npm publish`: releases go out when the release pull request merges, matching D36.
   - *Stage-only.* npm's new default: every release waits for your 2FA approval on npmjs.com, which guards against a compromised CI workflow (the May 2026 attack on @antv slipped past trusted publishing).

   Recommendation: direct publishing from a protected GitHub environment that only release-PR merges can trigger, with tokens disallowed and provenance on. It keeps D36 seamless, and the environment protection covers most of what staging adds.
3. **Everything else in this document** is a delegated design decision. Tell me if you want to veto or change any of it.
