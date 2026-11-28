# WP-24 progress: Web demos and exports

**Status:** accepted by Mirza on 2026-11-27 (M109: "You have my absolute acceptance, including the prose"). Owns TM-08 and VR-07 ([specification](../design/work-packages/WP-24.md)); the
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
- **The released CLI's verify on this Mac** (external): with the internal disk nearly full, the bundle cache had to sit on the external volume, where `verify` of a fresh page answers `MOSTRA_RUNTIME_NOT_READY` for 0.21.0 and 0.20.0 alike (#106, reopened with the evidence); the release's own smoke tests ran new, verify, publish and a submission through each bundle's browser on all six platforms (run 46088644747).
- **A demo build on a machine without the project's tools**: the build runs with the user's `PATH`; a missing tool fails the build with its own words (`MOSTRA_DEMO_BUILD_FAILED`), proven with a failing script, not a missing toolchain.

## Found while building

- **A quarantined hosted version's demos were still served** to a frame that entered before; the demo route now withholds them as the page's files are (`tenancy.test.ts`, seed TM-08 "quarantined hosted").
- **The demo cache grew without bound**: every source change kept a build forever. It keeps each demo's three newest; a version keeps its own copy, so nothing needs an older one (seed TM-08 "demo cache").
- **On Windows, Firefox refused a history-routed demo's move from disk silently**: its probe passed, so nothing caught the refusal. The guard now wraps the history API on every disk page and shows the notice for any refusal; the e2e check accepts a move or the notice in Firefox, and fails on silence.
- **Two publishes of one source raced on the cache's commit**; one build per digest at a time, and an entry once kept is never removed under a reader.
- **A sealed version couldn't be edited for `--base`**: the export's scratch copy is made writable first.
- **A single file's demo documents**: a `srcdoc` frame resolved a demo's `#` links against the page around it, so they are `blob:` addresses, with a script for Chromium's refusal of fragment navigation in them (VERIFIED_FACTS, WP-24).
- **`publish` and `demos` imported each other** (dependency-cruiser): the demos module keeps its own digest helpers.
- **CodeQL**: two time-of-check reads in a test helper; the removal of the build's own tags from a document (alerts 98 and 103), now cut out by position, each place left as a line break, so nothing beside a cut joins into a tag; and the e2e fixture demo's message handler, which now checks the sender's origin (alert 104).

## Review

- **Copilot** couldn't review: "the user who requested the review has insufficient remaining quota" (#253, every push).
- **The model review** (D172 item 0): Claude Opus, approved and run by Mirza (M108), posted on #253 on 2026-11-27 with 15 findings, graded "important" or "nit" and mapped onto P1 to P3 by him. Each is fixed with a test that fails on the old code and a seed planted where the fix holds (`node packages/runtime/scripts/prove-seeds.ts --name "WP-24 review"`), red when planted and green restored; the two Windows seeds run on Windows only (`windows-seeds.yml`). D185 item 10 records the outcomes.

| Finding | Severity | What was done | Test, and its seed |
|---|---|---|---|
| 1. `output: "."` publishes the whole source folder, `.env` too | P1 | The manifest refuses an output that is the source folder itself, and so does the builder, whatever spelling reaches it | `artifact.test.ts` "source folder itself"; `demos.test.ts` "source folder itself"; two seeds |
| 2. Pruning or `--force` removes a build a publish is copying | P1 | `build()` copies into the version or export inside the build's own turn, which pruning and `--force` take too; a copy marks the build used, so pruning keeps what versions just took | `demos.test.ts` "never used since"; seed |
| 3. A demo built from a source edited after its digest | P2 | The source is read again after the build; a change fails the build ("build it again"), never kept under the old digest | `demos.test.ts` "changed while its demo builds"; seed |
| 4. Symbolic links left out of the digest | P2 | The digest follows links as the build does, a link back into its ancestry skipped | `demos.test.ts` "through a link" (a junction on Windows); seed |
| 5. A submission's snapshot counts today's authors | P2 | Counted from the `state.changed` events up to the submission's state revision, with today's authors as a floor | `demos.test.ts` "counts the people"; seed |
| 6. gc can collect what an export is reading | P2 | The whole export holds the instance's gate shared, as a bundle's does | `demos.test.ts` "gc waits for an export"; seed |
| 7. `--base` told to the page though the demos weren't rebuilt | P2 | Told only when they were | `demos.test.ts` "names --base"; seed |
| 8. Exports drop another site's stylesheet | P2 | Kept in the page and named in the report | `plugins/mcp-app` `builtin.test.ts` "another site's stylesheet"; seed |
| 9. Windows: a relative `.cmd` path, and `cmd /c` quoting | P2 | A named program is found from the demo's folder; a `.cmd` runs as one `cmd.exe /d /s /c "…"` line escaped as cross-spawn escapes it, which the gate passes as it stands (`mostra-win gate --verbatim`) | `demos.test.ts` ".cmd build" (Windows legs: a script in a folder with a space, words with a space, `&` and quotes); two Windows seeds |
| 10. Cancelling a build does nothing | P2 | `demo/build` ends its build when its client goes away; an export's `--base` rebuilds likewise | `demos.test.ts` "goes away"; seed |
| 11. `mostra export` drops flags that don't fit | P2 | Usage error for `--strict`, `--base`, `--submission`, `--no-shared-state` with a plugin's exporter or a bundle, `--option` with a built-in class | CLI `contract.test.ts`; seed |
| 12. A gitignored `.env` left out of the digest | P2 | `.env` files count whatever `.gitignore` says; `.mostraignore` still excludes them | `demos.test.ts` "through a link"; seed |
| 13. The review agent before the doctype | P3 | After `<head>`, else `<html>`, else the doctype | unit `demo-agent.test.ts`; seed |
| 14. Values posted to `*` | P3 | Posted to the demo's own origin and heard only from it (`*` and `null` from disk). The new e2e check found that `onMessage` never heard a demo in WebKit: it names the page itself as a same-origin module script's sender (VERIFIED_FACTS, WP-24). Each demo document now gets its own `MessagePort` with its first values message, which every engine delivers | e2e `demos.spec.ts` live and from disk in three engines; seed |
| 15. Nested demo pages from disk resolve from the wrong place | P3 | A page below the demo's root gets `<base>` to the root | `builtin.test.ts` "below its root"; seed |

- **The issue met**: #227 (two property tests reach 30 s on a loaded machine) recurred in the local pre-push check, `gc.test.ts`, three times; it passed in every CI unit leg and alone in 9.6 s; the sighting is on the issue.

## CI

- **The baseline** (run on `e0f9f68a`, `ci:full`): green.
- **The first full run on the package** (45917138049, `d82da40e`): every job green but the Rust crate's wire types (regenerated), the CLI's contract test (`demo build` covered), and the history demo from disk on Windows Firefox (above).
- **The second** (45922733884, `caa7c987`, `ci:full`): green on every job and leg, Windows arm64 and the six-platform release rehearsal included.
- **After the review's fixes** (45989822156, `aeb2b8bc`): every job green but two browser tests outside this package, each at a step it doesn't touch (`kit.spec.ts`'s className test, its page load past 30 s on Linux WebKit; `surfaces.spec.ts`'s dark pass, a checkbox click on macOS Chromium); the Windows seeds of finding 9 on `windows-latest` (45989850569), each red when planted and green restored.
- **The final head** (45999914332, `3367999f`, `ci:full`): green on every job and leg, Windows arm64 and the six-platform release rehearsal included.
- **The merge queue** (#253): its first run (46024656696) met macOS `core`'s 10-minute deadline with every suite that ran passing, a slow runner (the same group took about 6 minutes on the pull request's run): #197, reopened with the evidence; its second run (46032373378) green on every leg.

## Deviations

- **A demo is a built front end, not a proxied dev server** (D185, M105): the dev-server proxy, its WebSocket passthrough, Host rewriting and framing-header stripping that the first specification named are out of v1; the specification, TM-08, VR-07, ARCHITECTURE §9, INTERFACES and the evidence were amended before building.
- **History-routed demos from disk** (M106): Chromium and WebKit refuse moving between paths in a page opened from disk, so such a demo says why in place; it moves fully on any web server, and hash-routed demos move everywhere.
- **A Next.js demo in a single HTML file** (M107): not carried; the page names it and the folder export holds it.
- **Size budgets**: `@mostra/react` 70 to 72 kB with Zod and 47 to 49 kB without (the demo hook, the export notice and the frozen live values).
- **The demos suite runs in `remote` and `windows-workers`**, not `extensions`, which neared its deadline on macOS (#262).

## Issues at the closeout

| Issue | State | What was done |
|---|---|---|
| #197 | Reopened, no milestone | macOS `core` met its deadline once more in #253's first queue run; evidence on the issue |
| #106 | Reopened, no milestone | A bundle on a volume without owners fails verify (0.20.0 and 0.21.0 alike); evidence on the issue |
| #95 | Open, no milestone | Windows arm64's emulated Chromium met `ERR_NO_BUFFER_SPACE` twice in a row in `client.spec.ts` on `main`'s run by hand (46069141633); evidence on the issue |
| #227 | Open, no milestone | The gc property test timed out under local load in the pre-push hook, never in CI; evidence on the issue |
| #263 | Filed, no milestone | J14's presence cursor missed its 10 s on Linux WebKit once (#262's run 46053090131) |

The `WP-24` milestone held no issue. None of these is in code this package changed; each stays on no milestone for the next package that touches its code (D155 item 7).

## Commits and publication

- **Range:** `022d1bb3..d313abc8` on `main`: the branch `wp/24-demos-exports` (27 signed-off commits, the last `f19e0ad5`) and its merge commit `d313abc8` (#253); then `c0b6e308` (#262, the demos suite's CI groups) and the version pull request #264 (`68f34295`).
- **CI:** #253's final head green on every job and leg (45999914332, `ci:full`); its merge-queue run 46032373378 green; #264's run 46069425699 and queue run 46083095823 green; `main`'s full run by hand (46069141633) green on its second attempt, after the #95 sighting.
- **Publication:** Mostra 0.21.0 by the `Release` workflow (run 46088644747 on `68f34295`, all 23 jobs green, 2026-11-28): the immutable GitHub release `v0.21.0` with the six bundles, their records, `SHA256SUMS` and attestations (13 assets); every package of the release group on npm at 0.21.0 with provenance (`npm view @mostra/cli@0.21.0` names an SLSA provenance attestation); the crate `mostra-host` 0.21.0 on crates.io; the harness plugin's tag `v0.21.0` in `mostra-dev/mostra-plugin`; the server image. The docs site arrives with WP-26.
- **From outside** (2026-11-28, this Mac, a scratch home, `npx -y @mostra/cli@0.21.0`): `--version` says 0.21.0; `mostra new`, `mostra demo build` (no demos: `{ demos: [] }`), `mostra export --as html`, `--as static` (its `index.html` marked `static`) and `--as snapshot` (`index.html`, `assets/`, `snapshot.json`) each answer `ok`; `mostra docs guide/demos` prints the Skill's demos reference. Verify there is the #106 boundary above.
- **Remaining dirty paths:** none in the repository. Outside it: the session's scratch on the external disk (`/Volumes/Active/wp24-scratch`: the demo prototypes, homes, the review text and the outside check). Mostra HQ was not written to (D127).

## Next

WP-25, First-party plugins (`docs/design/work-packages/WP-25.md`), beside WP-26, Templates, gallery and documentation site, which depends on this package and documents demos and exports (D184); WP-19 runs on its own branch. Each in a fresh session from `docs/design/work-packages/PROMPT.md` with its `WORK PACKAGE` line.

