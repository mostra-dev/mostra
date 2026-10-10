# Default Component, Visualization & Motion Kit for an Agent-Authored Artifact Toolkit (October 2026)

**Bottom line:** Ship shadcn/ui on Base UI with Tailwind v4.3 as the UI foundation. Use Recharts 3 (through shadcn charts) as the default chart layer, with uPlot for high-rate streams and ECharts 6 for heavy or exotic charts. Add TanStack Table, react-hook-form + Zod 4, Mermaid plus React Flow, MapLibre/deck.gl, react-three-fiber, Shiki/CodeMirror and KaTeX. For motion, use Motion (MIT) plus a small in-house frame/timeline primitive. Slides should be an in-house MDX deck runtime. Everything in the default set is MIT, Apache-2.0, BSD or ISC. GSAP, Remotion and tldraw are not OSI-licensed. They must stay opt-in, user-installed plugins and never be bundled dependencies.

## TL;DR

- **Default kit (all permissive licenses):**

| Category | Default |
|---|---|
| UI | shadcn/ui on Base UI + Tailwind v4 |
| Charts | Recharts 3 via shadcn `chart`; uPlot for streaming; ECharts 6 for scale and breadth |
| Tables | TanStack Table |
| Forms | react-hook-form + Zod 4, plus shadcn's new Questionnaire component |
| Diagrams | Mermaid 12 + @xyflow/react 12 + Excalidraw |
| Maps | MapLibre + deck.gl |
| 3D | react-three-fiber |
| Code | Shiki (display) + CodeMirror 6 (editing) |
| Math | KaTeX |
| Motion | Motion 14 |
| Slides | In-house MDX deck borrowing Slidev's concepts |

- **License red flags.**
  - **GSAP:** free, but under a proprietary Webflow "Standard 'No Charge' License". It prohibits use in no-code visual animation builders that compete with Webflow, and it cannot be relicensed as MIT.\[1\]
  - **Remotion:** proprietary. Companies of 4+ people need a paid Company License. Embedding the `<Player>` is classed as "automation", with a $100/month minimum.\[2\]
  - **tldraw 4.x:** needs a license key to run in production, and downstream users need their own license.\[3\]
  - **AG Grid Enterprise and Theatre.js Studio:** AG Grid Enterprise is commercial, and Theatre.js Studio is AGPL.\[4\]
- **The deciding tradeoff is LLM fluency versus API churn.**
  - Most of the ecosystem has just shipped breaking renames that models trained earlier will get wrong:
    - Radix→Base UI (`asChild`→`render`)
    - Tailwind v3→v4 (`tailwind.config.js`→CSS `@theme`)
    - `framer-motion`→`motion/react`
    - `reactflow`→`@xyflow/react`\[5\]
    - Recharts 2→3\[6\]
    - Zod 3→4
    - Mermaid 11→12 and Motion 13→14, both in Sep–Oct 2026\[7\]\[8\]
  - The kit should pin versions and ship an agent-facing `llms.txt`/AGENTS.md with "write this, not that" tables.
  - It should also enforce a typecheck → lint → headless-render → screenshot loop so outdated code fails fast instead of silently.

## Key Findings

### Verified facts (primary sources, checked October 2026)

**UI foundation**
- shadcn/ui made Base UI the default for new projects in July 2026. The changelog says: "Base UI is stable. It's at 1.6.0 with 6M+ weekly downloads". It also says new projects "pick Base UI over Radix 2 to 1". "Radix is not being deprecated", and every component will continue to ship for both libraries. Radix stays available with `shadcn init -b radix`.\[9\]
- shadcn added React Aria as a third first-class base in July 2026 (`shadcn init --base aria`). It covers all eight styles (Vega, Nova, Maia, Lyra, Mira, Luma, Rhea, Sera).\[10\]
- shadcn's docs now include `llms.txt`, "Skills", registry docs, Typeset (typography) and a Questionnaire component for multi-step question flows (August 2026). The Questionnaire is available for Base UI, React Aria and Radix.\[9\]\[11\]
- shadcn now documents three form libraries: React Hook Form, TanStack Form and Formisch.\[9\]
- As of September 2026, shadcn components import `cn` from a `cn` package. Previously `cn` was a hand-written helper in `lib/utils.ts`.\[11\]
- Base UI (MUI) timeline:
  - v1.0.0 shipped on 11 Dec 2025 under the new package name `@base-ui/react`.\[12\]\[13\]
  - v1.6.0 shipped on 18 Jun 2026. Latest is v1.8.0, released 4 Sep 2026.\[12\]\[13\]
  - Its peer dependency is React ^17 || ^18 || ^19.\[14\]
  - MUI described the project as maintained by "a full-time team of 7 engineers, designers, and managers".\[15\]
- Tailwind CSS: latest is 4.3.3 (16 Jul 2026). 4.3.0 shipped on 8 May 2026 and 4.2.0 on 18 Feb 2026. endoflife.date treats v3.4 as supported until 28 Feb 2027, based on an undocumented note from the creator.\[16\]

**Charts**
- Recharts: latest stable is 3.10.1. The 3.11 canaries add a theming system ("Update default themes to be more accessible", 3 Oct 2026).\[17\]
  - v3.0.0 (23 Jun 2025) rewrote state management. It removed `CategoricalChartState` and stopped `<Customized />` from receiving internal state.\[6\]\[18\]
- Apache ECharts: 6.0.0 shipped on 30 Jul 2025 with a new default theme, dark mode, axis breaks, matrix layout and chord/beeswarm charts. 6.1.0 shipped on 19 May 2026.\[19\]\[20\]
  - License is Apache-2.0.\[21\]
  - The 6.1.0 tag shows about 3.65M downloads in the last 7 days on npm.\[22\]
  - ASF board reports show 31 committers and 15 PMC members.\[23\]
- uPlot: latest is 1.6.32, about a year old. Its README calls it "A small (~50 KB min), fast chart", and its benchmark table lists v1.6.24 at 47.9 KB, against 254 KB for Chart.js v4.2.1.
  - The README benchmark: streaming 3,600 points at 60 fps uses "10% CPU and 12.3MB RAM", against 40%/77 MB for Chart.js and 70%/85 MB for ECharts.\[24\]
- Tremor joined Vercel on 22 Jan 2025, and all Tremor products, including Blocks, became MIT. It is built on React, Tailwind, Radix and Recharts.\[25\]

**Tables and forms**
- AG Grid: `ag-grid-community` is MIT and free for production. `ag-grid-enterprise` is under a commercial EULA: $999 per developer (perpetual, 1 year of updates), or $1,498 per developer for the Enterprise Bundle.\[26\]
  - Community now includes an MCP Server; the AI Toolkit is Enterprise-only.\[27\]
  - Row grouping, pivoting, master/detail, the server-side row model and Excel export are all Enterprise features.\[28\]
- Zod: 4.6 shipped on 9 Sep 2026, and latest is 4.6.5 (13 Sep 2026).\[29\]
  - The root `zod` import has exported Zod 4 since July 2025. `zod/v3` remains available "forever".\[30\]
  - Zod Mini is now also published as `@zod/mini`.\[31\]
  - Core bundle sizes: Zod 3 is 12.47 kB gzip, Zod 4 is 5.36 kB and Zod Mini is 1.88 kB.\[32\]

**Motion**
- Motion: v14.0.0 shipped on 2 Oct 2026 under MIT. v13.4.0 (14 Sep 2026) added `AnimateView`, which provides view transitions built on React 19.3's `ViewTransition`.\[8\]\[33\]\[34\]
  - The import is `motion/react`; React Server Components use `motion/react-client`.\[35\]
  - Motion publishes `motion.dev/llms.txt` and an MCP server.\[8\]\[36\]
  - The paid Motion+ tier adds an "AI Kit", premium examples, Motion UI and APIs like Cursor and Ticker. The core library is fully MIT.\[36\]
- GSAP: latest is 3.15.0 (13 Apr 2026). Its npm license field reads `Standard 'no charge' license`, which is not an SPDX identifier.\[37\]\[38\] Verbatim license terms:
  - **Prohibited Uses:** "any implementation and/or use of GSAP Products in tools that allow users to build visual animations without code that encourages, induces, or materially assists in creating a solution that competes with Webflow's visual animation building capabilities".\[1\]
  - **Grant:** only "use, reproduce, display, and implement".\[39\]
  - **Restrictions:** you may not "Remove or alter any proprietary notices or branding".\[1\]
  - **Termination:** Webflow "may terminate this GSAP License… in its discretion".\[39\]
  - **AI-generated code (FAQ):** "AI-generated code is not a 'Prohibited Use'."\[1\]
- Remotion: the Terms v5.0 take effect with Remotion 5.0.
  - Remotion "is not open-source software according to the OSI definition".\[2\]\[40\]
  - The Free License covers individuals, organizations of up to 3 people, non-profits, and evaluation.\[2\]\[41\]
  - Remotion for Automators costs $0.01 per render with a $100/month minimum. Its definition of "automation" explicitly includes "using the `<Player>` component".\[2\]\[42\]
  - "Free License Users may embed the Remotion Player without purchasing Renders."\[2\]
  - Remotion for Creators costs $25 per seat per month.\[43\] A seat explicitly includes using "agentic coding tools such as Claude Code, Codex".\[2\]
  - Operating a rendering service where end users bring their own Remotion code is disallowed.\[2\]
  - `@remotion/player` is at 4.0.52x, and its license field is "SEE LICENSE IN LICENSE.md".\[44\]\[45\]
- Revideo: 0.11.0 (10 Jul 2026), MIT. It is a Motion Canvas descendant.\[46\] Revideo's own site says the team mainly works on its commercial Midrender editor, and recent engine changes have not been upstreamed.\[47\]
- Motion Canvas: MIT. Its creator (GitHub: aarthificial) opened the discussion "Switching to the GNU General Public License" on 29 Mar 2024, but the motion-canvas repo is still listed as MIT (last updated 2 Jul 2026).
- Theatre.js: `@theatre/core` 0.7.2 is Apache-2.0, but `@theatre/studio` (the editor) is AGPL-3.0-only. The core package is about two years old. The README says 1.0 development has "*temporarily* moved… to a private repo" and promises "We'll push our work back to this public repo soon", but the public repo was last updated on 14 Aug 2024.
- Lottie and Rive:
  - The dotLottie format and its official SDKs are MIT.\[48\] `@lottiefiles/dotlottie-react` is at 0.19.x, still pre-1.0.\[49\]
  - Rive's official runtimes are MIT.\[50\]\[51\] Authoring requires the proprietary Rive editor, which has a free tier and paid seats. Rive's pricing docs list Cadet at $17/seat/month, or $108/seat/year (about $9/month), capped at 3 seats and including "Exports for runtime".

**Diagrams**
- tldraw SDK 4.0: "Production deployments now require a license key", while development and localhost are exempt.\[3\]\[52\]
  - Options are a 100-day trial, a commercial license through sales, and a discretionary non-commercial hobby license with a "made with tldraw" watermark. tldraw has not published a price: BigGo News (19 Sep 2025) reported "$6,000 USD annually per team", and Hacker News commenters cited "$6,000 for a 10-person startup".
  - tldraw's license page says: "you and your downstream users will require their own trial, commercial, or hobby license".\[53\]
- Excalidraw: MIT, stable 0.18.1 (21 Apr 2026), more than 123k GitHub stars.\[54\]
- @xyflow/react: 12.12.0 (24 Sep 2026), MIT.\[55\]\[56\]
- Mermaid: 12.0.0 (10 Sep 2026), then 12.1.0, MIT. Version 12 targets ES2024 (Safari 17.4+, Node 22.12+) and makes ELK the default layout.\[7\]\[57\]\[58\]

**Maps and slides**
- deck.gl 9.4.0 (MIT).\[59\]
- @slidev/cli 53.0.0 (MIT).\[60\] Slidev is Vue-based.

### Not verified in this pass (treat as provisional)
I did not confirm current versions or dates for Spectacle, reveal.js, Shiki, CodeMirror, @monaco-editor/react, KaTeX, MapLibre GL, @react-three/fiber, TanStack Table/Form, react-hook-form, visx, Nivo, Plotly, Vega-Lite or Observable Plot.

Their licenses are long-standing and permissive, but I am stating these from memory:
- MIT: Spectacle, reveal.js, Shiki, CodeMirror, Monaco, KaTeX, r3f, TanStack, RHF, visx, Nivo, Plotly
- BSD-3-Clause: MapLibre GL, Vega-Lite
- ISC: Observable Plot

Check each `npmjs.com/package/<name>` page before you pin versions.

## Details by Category

### 1. UI foundation

| Option | License | Status (Oct 2026) | Composition API | Agent fluency | Fit |
|---|---|---|---|---|---|
| **shadcn/ui + Base UI** | MIT | Default base since Jul 2026; Base UI 1.8.0 | `render` prop | Medium-high, rising: shadcn docs, `llms.txt` and Skills now default to it | **Best** |
| shadcn/ui + Radix | MIT | Fully supported, not deprecated | `asChild` | **Highest** (3+ years of training data) | Strong fallback |
| shadcn/ui + React Aria | Apache-2.0 (RAC) | First-class base since Jul 2026 | RAC render props/state selectors | Medium; shadcnblocks still labels its React Aria builds "Beta" | Best for strict a11y/i18n |
| Mantine | MIT (from memory) | Not verified | Batteries-included, own styling system | High | Fights Tailwind/shadcn tokens |
| Ark UI | MIT (from memory) | Not verified | State-machine (Zag) | Low-medium | Niche |
| Tailwind v4.3 | MIT | 4.3.3 | CSS-first `@theme`, OKLCH tokens | Medium: models often emit v3 config | **Required** |

**Recommendation, ranked:**
1. **shadcn/ui (Base UI base) + Tailwind v4.3, with components pre-installed in the toolkit.** Agents then import `@/components/ui/*` and rarely touch the primitives. That shrinks the Radix-vs-Base-UI fluency gap to a handful of composition sites (`asChild` vs `render`), and a lint rule can catch those with a fix-it message.
2. **shadcn on Radix.** Choose this if your evaluation shows meaningfully higher first-pass compile and render success.
3. **shadcn on React Aria.** Choose this for hosts with strict accessibility requirements.

**Theming and "beautiful by default":**
- Use shadcn's CSS-variable tokens (`--background`, `--primary`, `--chart-1…5`, and so on) in OKLCH, mapped through Tailwind v4 `@theme`.
- Dark mode should use a `.dark` class on `<html>`, driven by `prefers-color-scheme` plus a host-overridable setting. Host ports can then inject brand themes without touching component code.
- Ship one curated style (Nova or Vega) and use shadcn Typeset for prose. Artifacts inherit good typography and spacing with zero effort.

**What would overturn this:** an internal evaluation where Base UI artifacts compile or render noticeably less often than Radix artifacts with the same prompts. In that case, switch the default to Radix; the shadcn wrapper layer makes this a registry-config change.

### 2. Charts

| Library | License | Rendering | Static | Interactive | Streaming | Agent fluency | Notes |
|---|---|---|---|---|---|---|---|
| **Recharts 3 (via shadcn `chart`)** | MIT | SVG | ✓ | ✓ | Weak at high rates | **Highest** | v2→v3 breaking; 3.11 adds themes |
| **uPlot** | MIT | Canvas2D | ✓ | ✓ (zoom/cursor sync) | **Best**: 60 fps, ~50 KB min | Low-medium (imperative API) | Wrap it once in our own React component |
| **ECharts 6** | Apache-2.0 | Canvas/SVG (+GL ext.) | ✓ | ✓ | Good | High (huge corpus; JSON option objects) | Dark mode, financial charts, 20+ types; heavier bundle |
| Vega-Lite | BSD-3 | Canvas/SVG | ✓ | ✓ | Moderate | High (JSON spec) | Good "grammar" escape hatch |
| Observable Plot | ISC | SVG | ✓ | Limited | Weak | Medium | Fast exploratory charts |
| Visx | MIT | SVG primitives | ✓ | ✓ | Moderate | Medium (low-level) | Bespoke viz |
| Nivo | MIT | SVG/Canvas | ✓ | ✓ | Weak | Medium | Pretty but heavier |
| Plotly.js | MIT | SVG/WebGL | ✓ | ✓ | Moderate | High (scientific) | Very large bundle |
| Tremor | MIT | Recharts | ✓ | ✓ | Weak | High | Overlaps with shadcn charts |

**Recommendation, ranked:**
1. **shadcn chart + Recharts 3** for the default dashboard. It is themed by `--chart-*` tokens, so dark mode comes for free, and models have the most training data for it.
2. **uPlot** for the "live data view" requirement whenever updates exceed a few Hz or series exceed about 10k points. The toolkit should own a `<LiveChart>` wrapper that reads the same CSS tokens.
3. **ECharts 6** for anything Recharts lacks (heatmaps, Sankey, candlesticks, geo, very large datasets), wrapped with token-aware theming.
4. **Vega-Lite** as an optional dependency when an agent wants to emit a declarative spec.

Tremor adds little over shadcn charts, since both sit on Recharts.

**What would overturn this:** Recharts 3.x showing poor performance on mid-size data, or an AG Charts/ECharts React layer with better token theming. If a single library covered both streaming and the rich catalogue well, the three-library split would collapse to one.

### 3. Tables, forms, diagrams, maps, 3D, code, math

| Category | Default | Alternatives | Key reason | License note |
|---|---|---|---|---|
| Tables | **TanStack Table** + shadcn Data Table | AG Grid Community (MIT) for spreadsheet-like grids | Headless, uses shadcn tokens, high fluency | **Never** depend on `ag-grid-enterprise` (commercial EULA, $999/dev) |
| Forms | **react-hook-form + Zod 4** (+ shadcn Field, Questionnaire) | TanStack Form, Formisch | Most training data; shadcn documents all three | Zod 3→4: string formats moved to the top level (`z.email()`), and root `zod` is v4 |
| Diagrams (text) | **Mermaid 12** | — | Agents write text, so there is no layout work | v12 needs ES2024 / Safari 17.4+ |
| Diagrams (interactive) | **@xyflow/react 12** | — | Node editors, review graphs | The old `reactflow` package name trips up models |
| Whiteboard | **Excalidraw** (MIT) | tldraw (opt-in only) | No key or watermark | tldraw needs production keys, and downstream users need licenses |
| Maps | **MapLibre GL + deck.gl 9.4** | Leaflet | WebGL, vector tiles, big data overlays | You need a tile source; avoid key-gated defaults |
| 3D | **react-three-fiber + drei** | Raw three.js | Declarative, high fluency | Check the React 19 major compatibility |
| Code (display) | **Shiki** | Prism | VS Code-grade themes, works at build time or on the server | — |
| Code (edit) | **CodeMirror 6** | Monaco | Modular, mobile-friendly, small | Monaco is heavy and works poorly on phones |
| Math | **KaTeX** | MathJax | Fast, synchronous, works with MDX via rehype | — |

**What would overturn these picks:**
- **AG Grid Community for TanStack Table:** if agents routinely need Excel-like editing on 100k+ rows, AG Grid Community's built-in virtualization beats TanStack Table plus manual virtualization. It is MIT, so the license is fine as long as Enterprise imports are lint-blocked.
- **TanStack Form for react-hook-form:** if its fluency catches up.

### 4. Motion

| Library | License | Programmatic | Embeddable/interactive | Agent fluency | Fit for an MIT/Apache toolkit |
|---|---|---|---|---|---|
| **Motion 14** | MIT | ✓ (declarative + `animate()` sequences) | ✓ | **Highest**; `llms.txt` + MCP | **Default** |
| GSAP 3.15 | Proprietary "no charge" (Webflow) | ✓ (timelines) | ✓ | Very high | **Opt-in only.** It can't be relicensed, and the termination and amendment clauses are discretionary. A visual timeline editor in the toolkit would risk the Prohibited-Use clause. |
| Remotion 4.x (5.0 terms) | Proprietary (Remotion License) | ✓ (frame-based React) | Player ✓ | High, with Agent Skills | **Opt-in plugin only.** Companies of 4+ embedding `<Player>` need Automators ($100/month minimum). |
| Motion Canvas | MIT (GPL switch discussed) | ✓ (generators, canvas) | Limited | Low-medium | Possible, but niche |
| Revideo 0.11 | MIT | ✓ + headless render | React player | Low | Maintenance risk: the public repo lags Midrender |
| Theatre.js | Core Apache-2.0 / Studio AGPL | ✓ | ✓ | Low | Avoid (stalled; AGPL editor) |
| Lottie/dotLottie | MIT | Playback only | ✓ (state machines) | Low for authoring | Include a player for designer-supplied assets |
| Rive | MIT runtimes / proprietary editor | Runtime control only | ✓ (state machines, data binding) | Very low (agents can't author `.riv`) | Optional player |

**Recommendation:**
- Make **Motion** the default for UI and micro-interactions, layout and shared-element transitions, and scroll effects. Use `AnimateView` for React 19.3 view transitions.
- For "motion graphics" (explainer animations, title sequences, data-story animations), ship a **small in-house composition primitive**:
  - `<Composition fps duration>`, `useFrame()`, `<Sequence from to>`, `interpolate()` and `spring()`.
  - Drive it with a Motion `MotionValue` clock, with play/scrub/loop controls.
  - It renders ordinary DOM, SVG and canvas.
  - Agents already write Remotion-style frame code fluently, so a Remotion-shaped API gives that fluency without the Player license trigger. This is a judgment call; the API shape itself is not protected by the Remotion License, but have counsel confirm before naming things identically.
- Offer **Remotion** and **GSAP** as documented, user-installed plugins with explicit license notices. Never bundle them as dependencies.
- Use dotLottie and Rive only as players for designer-made assets.

**What would overturn this:**
- Remotion relicensing its Player permissively, or GSAP moving to an OSI license, would let either become a first-class default.
- Revideo resuming public development would make it a credible MIT video-render path.

### 5. Presentations

| Option | Stack | License | Verdict |
|---|---|---|---|
| Slidev 53 | **Vue** + Markdown | MIT | Best concepts: `---` separators, frontmatter layouts, click steps, presenter mode, export. Wrong framework to embed. |
| Spectacle | React | MIT (maintenance not verified) | Usable, but its API and fluency are modest |
| reveal.js | Vanilla JS, React wrappers | MIT | Mature; keyboard handling, PDF export and speaker view; imperative integration |
| MDX deck pattern | React + MDX | — (in-house) | **Recommended** |

**Recommendation:** build an **in-house MDX deck runtime**.
- Use Slidev's grammar: `---` slide breaks, frontmatter `layout:` keys mapped to a small set of shadcn-styled layout components (cover, two-col, image-right, code, chart, quote), and a `<Click>`/`<Step>` primitive built on Motion.
- Add presenter view via a BroadcastChannel second window, print-to-PDF through CSS `@page`, and Shiki/KaTeX/Mermaid blocks.
- MDX gives agents the most fluent format, which is Markdown plus JSX.

**What would overturn this:** a maintained React-native Slidev equivalent appearing. Alternatively, the host may require PowerPoint export; a reveal.js-based path or a PPTX generator would then be worth adding.

## Consolidated Default Kit

| Category | Default | Alternatives (opt-in) |
|---|---|---|
| Styling | Tailwind CSS 4.3 | — |
| UI primitives | shadcn/ui on Base UI 1.8 | Radix, React Aria bases |
| Charts | shadcn chart / Recharts 3 | ECharts 6, uPlot (live), Vega-Lite, visx |
| Tables | TanStack Table | AG Grid Community |
| Forms | react-hook-form + Zod 4 + shadcn Questionnaire | TanStack Form |
| Diagrams | Mermaid 12, @xyflow/react 12, Excalidraw | tldraw (user-licensed) |
| Maps | MapLibre GL + deck.gl | Leaflet |
| 3D | react-three-fiber + drei | — |
| Code | Shiki, CodeMirror 6 | Monaco |
| Math | KaTeX | MathJax |
| Motion | Motion 14 + in-house composition primitive | GSAP, Remotion (user-licensed), dotLottie, Rive players |
| Slides | In-house MDX deck | reveal.js |

## License-Risk Table

| Library | License (SPDX) | Commercial restriction | Risk to an MIT/Apache toolkit |
|---|---|---|---|
| shadcn/ui, Base UI, Tailwind, Recharts, uPlot, TanStack, RHF, Zod, Motion, @xyflow/react, Mermaid, Excalidraw, deck.gl, r3f, Shiki, CodeMirror, KaTeX, dotLottie, Rive runtimes, Tremor | MIT | None | **Low** |
| ECharts, React Aria, Theatre core | Apache-2.0 | None (NOTICE file obligations) | Low |
| MapLibre GL, Vega-Lite | BSD-3-Clause | None | Low |
| Observable Plot | ISC | None | Low |
| AG Grid Community | MIT | None; Enterprise features are a separate package | Low, provided `ag-grid-enterprise` is blocked |
| AG Grid Enterprise | Commercial EULA | $999–$1,498 per developer | **High.** Don't bundle it |
| GSAP | Non-SPDX (Webflow Standard "No Charge") | Ban on competitive no-code visual builders; discretionary termination; no relicensing | **Medium-high.** User-installed only |
| Remotion / @remotion/player | Proprietary (Remotion License) | Companies of 4+ pay; Player embedding = Automators, $100/month minimum | **High.** Plugin only, with a notice |
| tldraw SDK 4.x | Proprietary (tldraw license) | Production key; downstream users need their own license | **High.** Exclude |
| Theatre.js Studio | AGPL-3.0-only | Copyleft, including over the network | **High.** Exclude |
| Rive editor | Proprietary SaaS | Paid seats | N/A to code, but limits who can author |
| Motion+ | Commercial | Paid examples and AI Kit | None, if unused; the core is MIT |

## Decisive Cross-Cutting Tradeoffs

1. **Fluency versus freshness.** The most-trained APIs are often the deprecated ones: Radix `asChild`, Tailwind v3 config, `framer-motion`, `reactflow`, Recharts 2 internals, Zod 3 string methods, `lib/utils` `cn`. I found no published benchmark measuring LLM accuracy per library.
   - Mitigate with pinned versions, a toolkit `llms.txt`/AGENTS.md containing old→new rewrite tables, and ESLint rules with autofix (for example, flag `asChild`, `from "framer-motion"`, `from "reactflow"` and `tailwind.config.js`).
   - Also link vendor agent docs: shadcn `llms.txt` and Skills, Motion `llms.txt`/MCP, and the AG Grid MCP server.
   - Measure it yourself: run a 50-prompt artifact evaluation per candidate and score typecheck pass, render without errors, and screenshot review.
2. **Agents can't see the browser.** Prefer libraries whose failures surface as type or console errors over silent visual breakage. Ship headless rendering (Playwright) with screenshot capture, so an agent can check that a chart actually drew. This favours typed, declarative APIs (Recharts, ECharts options, Mermaid text) over imperative canvas code.
3. **One token system.** Every default must read shadcn CSS variables, including charts (`--chart-n`), uPlot and ECharts wrappers, CodeMirror and Shiki themes, and MapLibre styles. That is what makes the kit "beautiful by default" and lets host ports inject brand themes and dark mode once.
4. **Licensing on the bundle boundary.** Keep the toolkit's dependency tree OSI-only. Proprietary engines (GSAP, Remotion, tldraw) stay behind a plugin interface that the user installs and licenses. This matters doubly because tldraw and Remotion obligations flow to downstream users of the embedding host.
5. **Streaming is a separate path.** SVG/React chart libraries re-render per update and won't hold 60 fps at high point counts. Keep a canvas path (uPlot) with an append-only data buffer fed by the host event port.

## Caveats
- Several version numbers come from npm "N days ago" snippets whose crawl date is unknown. The 16 libraries listed above as unverified need direct registry checks before pinning.
- No vendor-neutral benchmark of LLM code accuracy per library exists that I could verify. Fluency rankings here are judgments based on corpus age, API churn and vendor agent tooling.
- Remotion's v5.0 terms are labelled "upcoming" and apply from Remotion 5.0; v4.0 terms govern the current 4.x line.
- The $6,000/year tldraw price comes from BigGo News and Hacker News commenters, not a tldraw price list.
- This report is not legal advice. Have counsel review the GSAP and Remotion terms before shipping any plugin integration.

## Sources

1. [Standard License](https://gsap.com/community/standard-license/)
2. [Terms and Conditions of Remotion (v5.0)](https://www.remotion.dev/docs/terms)
3. [Open-source tldraw alternatives in 2026 — Quickdraw](https://tryquickdraw.com/blog/open-source-tldraw-alternatives)
4. [@theatre/studio - npm](https://www.npmjs.com/package/@theatre/studio)
5. [✨ @xyflow/react - React Flow 12 is out · xyflow/xyflow · Discussion #3764](https://github.com/xyflow/xyflow/discussions/3764)
6. [Release v3.0.0 · recharts/recharts](https://github.com/recharts/recharts/releases/tag/v3.0.0)
7. [Releases · mermaid-js/mermaid](https://github.com/mermaid-js/mermaid/releases)
8. [Motion (prev Framer Motion): JavaScript & React animation library](https://motion.dev/)
9. [July 2026 - Base UI as the Default - shadcn/ui](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default)
10. [July 2026 - React Aria - shadcn/ui](https://ui.shadcn.com/docs/changelog/2026-07-react-aria)
11. [Changelog - shadcn/ui](https://ui.shadcn.com/docs/changelog)
12. [Releases · Base UI](https://base-ui.com/react/overview/releases)
13. [shadcn/ui Has Switched From Radix to Base UI](https://blog.openreplay.com/shadcn-ui-radix-base-ui-switch/)
14. [mui/base-ui](https://deepwiki.com/mui/base-ui)
15. [Show HN: Base UI v1.0 Unstyled UI Components from the Creators of Radix and MUI](https://news.ycombinator.com/item?id=46245401)
16. [Tailwind CSS](https://endoflife.date/tailwind-css)
17. [Releases · recharts/recharts](https://github.com/recharts/recharts/releases)
18. [recharts/recharts v3.0.0 on GitHub](https://newreleases.io/project/github/recharts/recharts/release/v3.0.0)
19. [Releases · apache/echarts](https://github.com/apache/echarts/releases)
20. [Apache ECharts on X: "🚀 Apache ECharts 6.0.0 is here! ✨ 12 groundbreaking upgrades: - Chord/Beeswarm/Jitter Scatter - Axis Break & Stock Charts+ - Matrix Layout & Dark Mode Unleash next-gen data storytelling! 🔗https://t.co/uttI22CFVs https://t.co/gFsKpbxbKD" / X](https://x.com/ApacheECharts/status/1952629667443466453)
21. [Apache ECharts](https://www.npmjs.com/package/echarts)
22. [echarts - npm](https://www.npmjs.com/package/echarts?activeTab=versions)
23. [Board history: ECharts](https://www.apache.org/foundation/board/minutes/ECharts.html)
24. [GitHub - leeoniya/uPlot: 📈 A small, fast chart for time series, lines, areas, ohlc & bars](https://github.com/leeoniya/uplot)
25. [Vercel acquires Tremor to invest in open source React components - Vercel](https://vercel.com/blog/vercel-acquires-tremor)
26. [AG Grid Enterprise: Advanced Data Grid Features for Professional Applications](https://www.ag-grid.com/landing-pages/enterprise-data-grid/)
27. [ag-grid-community - npm](https://www.npmjs.com/package/ag-grid-community)
28. [5 Best AG Grid Alternatives in 2026 (+ AG Grid Pricing) - TFC](https://www.thefrontendcompany.com/posts/ag-grid-alternatives)
29. [Zod 4.6](https://zod.dev/blog/zod-4-6)
30. [Versioning](https://zod.dev/v4/versioning)
31. [zod/mini](https://www.npmjs.com/package/@zod/mini)
32. [Release notes](https://zod.dev/v4)
33. [motion - npm](https://www.npmjs.com/package/motion)
34. [Changelog - Framer Motion](https://motion.dev/changelog)
35. [React motion component](https://motion.dev/docs/react-motion-component)
36. [GitHub - motiondivision/motion: A modern animation library for React and JavaScript · GitHub](https://github.com/motiondivision/motion)
37. [gsap - npm](https://www.npmjs.com/package/gsap)
38. [gsap](https://security.snyk.io/package/npm/gsap)
39. [gsap-standard-no-charge-2025 - ScanCode LicenseDB](https://scancode-licensedb.aboutcode.org/gsap-standard-no-charge-2025.html)
40. [Is Remotion Free? License and Pricing Explained (2026)](https://autoae.online/blog/is-remotion-free)
41. [Legal - Vemotion AI](https://vemotionai.com/legal)
42. [Terms and Conditions](https://www.remotion.pro/terms)
43. [Remotion: React Video Framework, Pricing & Alternatives](https://www.therundown.ai/tools/remotion)
44. [@remotion/player CDN by jsDelivr - A CDN for npm and GitHub](https://www.jsdelivr.com/package/npm/@remotion/player)
45. [@remotion/player - npm](https://www.npmjs.com/package/@remotion/player)
46. [Remotion vs Revideo — React components or TypeScript generators (2026)](https://snapcn.dev/remotion-vs-revideo)
47. [10 Best Remotion Alternatives in 2026, by Workflow · Voyager](https://voyager.so/blog/remotion-alternatives)
48. [dotLottie: The Open .lottie Animation Format](https://lottiefiles.com/dotlottie)
49. [Package dotlottie-react · GitHub](https://github.com/orgs/LottieFiles/packages/npm/package/dotlottie-react)
50. [Getting Started with the Rive Runtimes - Rive](https://rive.app/docs/runtimes/getting-started)
51. [@rive-app/react-canvas - npm](https://www.npmjs.com/package/@rive-app/react-canvas)
52. [v4.0.0 • tldraw Docs](https://tldraw.dev/releases/v4.0.0)
53. [License • tldraw Docs](https://tldraw.dev/community/license)
54. [Excalidraw](https://en.wikipedia.org/wiki/Excalidraw)
55. [@xyflow/react - npm](https://www.npmjs.com/package/@xyflow/react)
56. [Releases · xyflow/xyflow](https://github.com/xyflow/xyflow/releases)
57. [mermaid](https://security.snyk.io/package/npm/mermaid)
58. [mermaid - npm](https://www.npmjs.com/package/mermaid)
59. [deck.gl - npm](https://www.npmjs.com/package/deck.gl)
60. [@slidev/cli - npm](https://www.npmjs.com/package/@slidev/cli)
