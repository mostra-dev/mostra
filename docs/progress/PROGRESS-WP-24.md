# WP-24 progress: Web demos and exports

**Status:** in progress. Owns TM-08 and VR-07 ([specification](../design/work-packages/WP-24.md)); the
`WP-24` milestone holds no open issue.

## Baseline

| | |
|---|---|
| Branch | `wp/24-demos-exports`, created from `origin/main` |
| Starting `HEAD` | `022d1bb3` (`origin/main`, 2026-11-26: "docs(design): D184, motion, decks and the evaluation suite after the first release (#252)") |
| `git status` | clean |
| Static jobs | `pnpm check --job format-lint --job types --job build --job boundaries --job api --job docs --job licenses` on `022d1bb3`, 2026-11-26: every job green |
| Full baseline | CI's `ci:full` run on this pull request's first commit (a full local `pnpm check` is load-bound on this Mac, as in WP-14 to WP-20) |
| Predecessors | WP-20 ([PROGRESS-WP-20](PROGRESS-WP-20.md)) on `origin/main`, and WP-29 ([PROGRESS-WP-29](PROGRESS-WP-29.md)), whose `bundle` class and `mostra run` VR-07's bundle case reuses; no `RECOVERY-WP-24-*.md` |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |


## Decisions

Mirza's answers to the session's questions changed what a demo is: **D185** (M105 to M107), recorded before the build and amending TM-08, VR-07, WP-24's Builds and Evidence, ARCHITECTURE §3 and §9, INTERFACES §2.2, §13 and §15, DATA_MODEL §2, FAILURE_MODEL §2 and PRODUCT's J5. In short:

1. **A demo is a built front end**, not a running dev server: the output of Vite, a Next.js static export or any build that writes static files, built by Mostra from its source at verify, publish and on demand, kept with the version, and shown in `<WebDemo>` alike locally, through any share, on a remote server and in every export. Dev servers, hot reload, the per-demo port proxy, Host and Origin rewriting, WebSocket passthrough, framing-header stripping and anything with a server side are out of v1.
2. **The manifest's build form**: `{ source, build, output, env?, routing?, bridge?, timeout? }`; the build runs in `source` with the artifact environment, the user's `PATH` first and Mostra's Node.js last, and `MOSTRA_DEMO_BASE` (`/_mostra/demos/<name>/`); one build at a time per folder, its tree ended at its time limit; cached by its source's content, command, settings and base; `envDigest` gains `demoDigest` (absent without demos, so earlier version IDs hold). The earlier dev-server forms still parse and are refused at verify (`MOSTRA_DEMO_UNSUPPORTED`).
3. **Served from the artifact's own origin** under `/_mostra/demos/<name>/`, behind the frame session, with an SPA fallback, the review agent in its pages unless `bridge: false`.
4. **Exports carry the page's front end and its demos**: `static` (a folder whose `index.html` carries the page's code inline; each demo as built for a host's root and as a copy that opens from disk; `--base` rebuilds demos for a subpath), `html` (one file; demos that are one ES-module graph inside it, the others named), `snapshot` (static plus the frozen answers, state and live values; `--submission`, `--no-shared-state`). From disk, a history-routed demo opens on its first page in Chromium and WebKit, whose `file:` pages refuse moving between paths, and says so in its frame once per session (M106); a static export with one carries `README.txt`.
5. **No server code in an export, and nothing degrades silently**: actions, Submit and live producers are named in the warning (also in `--json`), `--strict` makes it an error and writes nothing, and controls show unavailable where they sit (`useAction().available`, `useLive().frozen`, `ActionButton`, the export's notice).

Taken inside the package: the built-in exporters live in the carried `@mostra/plugin-mcp-app` beside its single-file code and run in a plugin child (no new package, no bundler in the supervisor); a single file's demo documents are `blob:` addresses (a `srcdoc` frame resolves a demo's `#` links against the page around it), with a script that moves a hash link by `pushState` where Chromium refuses fragment navigation in them (VERIFIED_FACTS, WP-24); `@mostra/react`'s size budgets rise from 70 to 72 kB with Zod and 47 to 49 kB without (the export facts, the frozen live values and `useDemo`).

## What was built

| Part | Where | What it does |
|---|---|---|
| Protocol | `packages/protocol/src/manifest.ts`, `methods/demo/build.ts`, `methods/artifact/export.ts`, `diagnostics/codes/{demo,target}.ts`, `plugin/contracts.ts` | The demo build form and its checks; `demo/build`; `artifact/export`'s classes `static`, `html`, `snapshot` with `base`, `strict`, `submission`, `sharedState`, its `report` and `warnings`; the `DEMO` area (10 codes) and four `TARGET` codes; `demo build` among Mostra's own command words |
| Demos | `packages/runtime/src/demos/index.ts`, `processes/environment.ts`, `platform/tools.ts` | Builds in `demo-build` children, output checks, the cache, the review agent in demo pages; the build's environment; Windows' `PATHEXT` and `.cmd` commands |
| Publish and serving | `packages/runtime/src/publish/{publisher,methods,digest,source}.ts`, `gateway/index.ts`, `builder/child/spa.ts` | Demos built at verify and publish and kept under `client/_mostra/demos/<name>/`; `demoDigest`; the demo routes with their SPA fallback; the page's `mostra-demos` meta |
| Exports | `packages/runtime/src/exports/index.ts`, `plugins/bundled-page.ts`; `plugins/mcp-app/src/{builtin,bundle}.ts` | The three classes, their report and warnings, `--base` rebuilds, snapshots from the ledger; the exporters, the disk notice and the hash shim |
| Page | `packages/react/src/{demo,server-hooks}.ts`, `runtime/{exported,boot,store,server-client,verify-probe}.ts` | `useDemo`; the static and snapshot targets' stores (per-artifact keys, read-only snapshots, frozen live values), `available` and `frozen`; verify waits for demos |
| Kit | `packages/kit/src/{demo,action}.tsx` | `<WebDemo>` (device frames, a viewport switcher, values and messages), `<ActionButton>` |
| CLI | `packages/cli/src/commands/authoring.ts` | `mostra export --as static|html|snapshot` with `--base`, `--strict`, `--submission`, `--no-shared-state`; `mostra demo build` |
| Skill | `skills/mostra/references/demos.md`, `sharing.md`, `server.md`, `long-lived.md`, `SKILL.md` | Demos and exports for agents (for Mirza's acceptance, D149) |

## Evidence

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| TM-08 | verified | A Vite app and a Next.js static export, each with client-side routing and mock data, and a hash-routed app, build through the demo spec and pass verify; each is fully interactive in `<WebDemo>`, moves between its pages and opens from a deep link; a comment inside a demo anchors there (its review ID, a served frame) and survives a reload; through a share on another site the demos work the same; on a remote server's hosted page the demo is served from its label, deep links too, and withheld under quarantine; a broken build fails verify with its last log lines and publish refuses it; an output missing or loading files from outside its base fails; a good build is kept with the version and cached, and the cache keeps a demo's three newest builds | e2e `demos.spec.ts` "web demos built into the version"; `vitest --project integration test/integration/demos.test.ts`, `tenancy.test.ts` "hosted page's demo"; CLI `contract.test.ts` (`demo build`); seeds `prove-seeds.ts --only TM-08` (six) | passes in Chromium, Firefox and WebKit on Linux and macOS and in Chromium and Firefox on Windows (CI run 45922733884, `ci:full`); integration passes; each seed red, then green |
| VR-07 | verified | Each export class (static, html, snapshot) opens the page and every demo from disk in the three engines; a hash demo moves between pages from disk, a history demo shows its notice in Chromium and WebKit and moves in Firefox; a static export served at a host's root and, with `--base /sub/`, at `/sub/` moves and deep-links; the static target routes by hash on a host with no fallback, from the real exporter's output (AU-09); an export of a page with actions, a live producer and a secret holds none of their server code, values or environment, names what it loses, and writes nothing under `--strict`; a snapshot freezes the live value and the shared state, leaves the state out when asked, and keeps an answer's markup as text; the CLI writes each class and refuses a flag the class doesn't take; the bundle case is WP-29's `bundle` class and `mostra run` | e2e `demos.spec.ts` "exports carry the page and its demos", `pages.spec.ts` static case; `test/integration/demos.test.ts` (exports); CLI `contract.test.ts`; WP-29's `test/integration/bundle.test.ts`; seeds `--only VR-07` (four) | passes in the three engines on every system CI runs them (run 45922733884); integration passes; each seed red, then green |

## Untested boundaries

- **A Next.js demo inside a single HTML file**: its runtime loads classic chunks by address, so one file can't hold it; the file names it and the folder export carries it (D185 item 7).
- **A real static host at a subpath** (GitHub Pages): proven with a local server with no fallback at `/sub/`.
- **Real Safari and a phone**: WebKit only.
- **A demo build on a machine without the project's tools**: the build runs with the user's `PATH`; a missing tool fails the build with its own words (`MOSTRA_DEMO_BUILD_FAILED`), proven with a failing script, not a missing toolchain.

## Found while building

- **A quarantined hosted version's demos were still served** to a frame that entered before; the demo route now withholds them as the page's files are (`tenancy.test.ts`, seed TM-08 "quarantined hosted").
- **The demo cache grew without bound**: every source change kept a build forever. It keeps each demo's three newest; a version keeps its own copy, so nothing needs an older one (seed TM-08 "demo cache").
- **On Windows, Firefox refused a history-routed demo's move from disk silently**: its probe passed, so nothing caught the refusal. The guard now wraps the history API on every disk page and shows the notice for any refusal; the e2e check accepts a move or the notice in Firefox, and fails on silence.
- **Two publishes of one source raced on the cache's commit**; one build per digest at a time, and an entry once kept is never removed under a reader.
- **A sealed version couldn't be edited for `--base`**: the export's scratch copy is made writable first.
- **A single file's demo documents**: a `srcdoc` frame resolved a demo's `#` links against the page around it, so they are `blob:` addresses, with a script for Chromium's refusal of fragment navigation in them (VERIFIED_FACTS, WP-24).
- **`publish` and `demos` imported each other** (dependency-cruiser): the demos module keeps its own digest helpers.
- **CodeQL**: two time-of-check reads in a test helper, and the removal of the build's own tags from a document, now repeated until none is left.

## Review

- **Copilot** couldn't review: "the user who requested the review has insufficient remaining quota" (#253, every push).
- **The model review** (D172 item 0): pending Mirza's run or approval (D34).
- **The issue met**: #227 (two property tests reach 30 s on a loaded machine) recurred in the local pre-push check, `gc.test.ts`, three times; it passed in every CI unit leg and alone in 9.6 s; the sighting is on the issue.

## CI

- **The baseline** (run on `e0f9f68a`, `ci:full`): green.
- **The first full run on the package** (45917138049, `d82da40e`): every job green but the Rust crate's wire types (regenerated), the CLI's contract test (`demo build` covered), and the history demo from disk on Windows Firefox (above).
- **The second** (45922733884, `caa7c987`, `ci:full`): green on every job and leg, Windows arm64 and the six-platform release rehearsal included.

