# WP-04 progress: dependencies

**Status:** Candidate, awaiting the independent review (D80) and Mirza's acceptance. The report is finalized after acceptance (work-packages/README.md §4).

## Baseline

| | |
|---|---|
| Branch | `wp/04-deps`, created from `origin/main` |
| Starting `HEAD` | `34ab3b6fb1c9ed6c3964a65b517ded630faefbb0` (`origin/main` at session start, 2026-10-13: "docs(progress): finalize the WP-03 report (#11)") |
| `git status` | clean |
| `pnpm check` | red in one job: `unit` failed in `tools/test/gates.test.ts` with `rsync failed: … packages/runtime/dist/bin.d.ts: … No such file or directory`. The gate tests copied the working tree, `dist/` included, while the parallel `build` task rewrote `packages/runtime/dist`. `pnpm check --job unit` alone passed (159 s). Every other job passed: format-lint, types, integration, build, boundaries, api, licenses, rust, docs, commits (3 min 44 s, macOS arm64). Fixed in this package (`tools/test/repo-copy.ts` leaves `packages/*/dist` out of the copy; the copy's own build makes it) |
| Predecessors | WP-03 done ([PROGRESS-WP-03](PROGRESS-WP-03.md) on `origin/main`); no `RECOVERY-WP-04-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, macOS arm64 |
| Pull request | [#12](https://github.com/mostra-dev/mostra/pull/12), draft |

## What was built

- **`@mostra/protocol`:** the host method `deps/add` (`{ artifact: SourceRef, packages, requestId? }` → `{ packages: AddedPackage[], lockDigest }`); `HomeConfig.dependencies` (`"auto" | "explicit"`) and the `DependencyPolicy` type; seven codes in the DEP area with docs pages: `MOSTRA_DEP_MISSING`, `_NOT_FOUND`, `_OFFLINE`, `_TIMEOUT`, `_INSTALL_FAILED`, `_WARM_CONFLICT`, `_SPEC_INVALID`.
- **`@mostra/warm`:** the rest of ROUND-3 §1.2's warm set and `@hookform/resolvers` (D72): 43 packages, every React-based one with React as a peer.
- **`@mostra/runtime`:**
  - `deps` (new module): the warm set (moved from `builder`); the static import scan (scripts with static, dynamic and `require` imports, `export … from` and `@jsxImportSource`; MDX ESM blocks; CSS `@import`, `@plugin`, `@reference`; type-only imports and declaration files skipped); package names and specs; the lockfile (`lock.yaml` with optional `packages` and `pnpm` sections, its digest); working lockfiles and the store index in the ledger; lock layouts `deps/locks/<lockDigest>` that link the warm set through a `warm` symlink, complete only with their marker, relinked when the runtime moves; the pnpm 10 install child with the release age in each project's `pnpm-workspace.yaml`, pinned settings and NDJSON error mapping; offline answers from the store index before any child starts; the 300 s install limit; `deps/add`; recovery of unfinished layouts and resolutions at start.
  - `processes`: `artifactEnvironment`, the allowlist children of artifacts get; `SpawnSpec.onStdout`, with `exited` waiting for the output pipes to drain.
  - `home`: the home's settings (`config.json`), written atomically, failing closed on a damaged file.
  - `protocol-server`: `configureHome`, which applies `HomeConfig` settings during `mostra/initialize`.
  - `publish` and `registry`: publish resolves dependencies into `lock.yaml` and `lockDigest`, and a path-keyed working lockfile moves to the artifact inside the publish transaction; `deps/add` runs in the source path's queue.
  - `builder`: takes its `node_modules` from the caller; the `mostra:confine` plugin also refuses a package's import of a dependency it doesn't declare when only a `node_modules` above the home has it; build package roots follow workspace links.
  - Ledger migration 3: `dependency_lock`, `dependency_package`.
- **Tests:** `test/registry.ts`, a local npm registry with fixture packages (a React peer, a recording postinstall, a failing and a slow script, a fresh release, a phantom dependency); `test/integration/deps.test.ts`; `test/unit/deps.test.ts`; the updated `ancestors.test.ts`; `test/external/npm.test.ts`, the real-npm check (`test:external`, never in CI); eleven DP seeds in `scripts/prove-seeds.ts`.
- **Repository machinery:** the license audit covers the shipped warm set's closure, refuses `pnpm` 11 or later and `@pnpm/exe.*` (D94), accepts EPL-2.0 (OSI) and records khroma 2.1.0's verified MIT license; knip knows the warm package and the installer file; the gate copy leaves `dist/` out.

## Decisions taken in the package

M15 and D94, D95 (recorded on this branch). Mirza delegated all eight questions (M15). Within them:

- **D94, pnpm 10 inside Mostra.** pnpm 12's native binary links PolyForm Shield `pnpr` crates, and pnpm 11's bundle carries `pnpr/client` from the Shield-licensed directory; pnpm 10.34.6 has no pnpr code and every capability WP-04 needs. The repository's own pnpm 12 stays: Mostra never ships it. Mirza asked why the `pnpr` rule exists: PolyForm Shield allows any use except providing a product that competes with the licensor's, which is not an OSI license, and D14 and D26 keep every component users install OSI-licensed. So Shield code can't ship inside Mostra however the competition question would be read (D20). pnpm 10 costs nothing in capability; it was the fastest of the three in the prototype.
- **D95, the dependency model:** the warm layer and lock layouts with `link:warm/…`, the working lockfile in the ledger, the additive lockfile format, static import discovery with exact pins, the policy in `config.json`, `deps/add` as `mostra add`, the one-day release age for packages without an exact version, lifecycle scripts in the install child with the artifact environment, and the offline rules. D95's allowlist was widened in this package to the user's name and shell and the native-build toolchain variables (`CC`, `CXX`, `XDG_*` …), which `node-gyp`-style scripts need and which carry no secret.
- pnpm 10 honors `minimumReleaseAgeExclude` only from the project's `pnpm-workspace.yaml`, so each install project writes one (age 1440 with exact names exempt for resolutions, 0 for frozen installs, which re-check locked versions).
- A user's npm settings are honored (registry, scopes, proxies, credentials), except those D95 fixes: `ignore-scripts`, `shamefully-hoist`, the global virtual store, the store, cache and layout locations.

## Evidence

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| DP-01 | verified | A real daemon publishes an artifact importing zod, react-hook-form, recharts, motion and lucide-react: no install child starts (supervisor log), the registry gets no request, no lock layout exists, and `lock.yaml` lists the warm set only. An artifact importing an on-demand fixture that peer-depends on React and calls `useState` from its own `react` import: its `.pnpm/<pkg>/node_modules/react` is the warm set's React directory, and in Chromium the package's React module is the page's (`ReactFromPeer === React`), its hooks count two clicks, no console or page errors. External: `@react-three/fiber` 9.8.1 from npm renders a WebGL scene with React 19.3.0 and pnpm installed no `react` or `react-dom` of its own | `pnpm --filter @mostra/runtime test:integration` (`deps.test.ts` › DP-01); CI run [38532578365](https://github.com/mostra-dev/mostra/actions/runs/38532578365) `integration` on Linux and macOS; `node packages/runtime/scripts/prove-seeds.ts --only DP-01`; `pnpm --filter @mostra/runtime test:external` | green; seeds (warm imports treated as on-demand; layouts without the warm React link, so pnpm installs a second React) red, green when restored |
| DP-02 | verified | An unknown import installs through pnpm 10 into `deps/store`; `lock.yaml` gains `packages` (`mostra-fixture-peer` 1.1.0) and `pnpm` (with its transitive `mostra-fixture-util`); a second artifact with the same import fetches nothing, starts one resolution and shares the one layout. With `HomeConfig.dependencies: "explicit"` (persisted in `config.json`), publish answers `MOSTRA_DEP_MISSING` at `index.tsx:2:23` with the fix `mostra add mostra-fixture-util --artifact <dir>`; `deps/add` with that package fulfils it and the next publish succeeds. `deps/add` refuses a git spec (`_SPEC_INVALID`), a warm package at another major (`_WARM_CONFLICT`), an unknown package (`_NOT_FOUND`), a failing postinstall (`_INSTALL_FAILED` with the script's output), and a release younger than a day without an exact version (`_NOT_FOUND`), which installs when named exactly. **External:** on 2026-10-14 a fresh home installed `@react-three/fiber` 9.8.1 with `three` 0.186.1, `zustand` 5.0.15, `its-fine` 2.1.1 and the rest of its graph from registry.npmjs.org in 4 to 6 s | `deps.test.ts` › DP-02; `prove-seeds.ts --only DP-02`; `test:external` (macOS arm64, real npm) | green; seed (explicit policy ignored) red, green when restored |
| DP-03 | verified | Adding `mostra-fixture-peer@1.0.0` to an artifact whose source is unchanged gives version 2 with the same `sourceDigest` and a different `envDigest`; publishing again reuses version 2. A published version whose directory and every lock layout were deleted republishes under `MOSTRA_OFFLINE=1` with an unreachable registry: the same version ID and number, rebuilt from the store, no registry request. A lock layout relinks the warm set when the runtime moved (the first warm location deleted) and rebuilds offline. Unit: any change to `packages` or the pnpm text changes `lockDigest`; WP-03's lockfile form is unchanged without on-demand packages | `deps.test.ts` › DP-03; `test/unit/deps.test.ts`; `prove-seeds.ts --only DP-03` | green; seeds (lockfile left out of `envDigest`; installs not recorded in the store index; layouts not relinked) red, green when restored |
| DP-04 | verified | Under `MOSTRA_OFFLINE=1`, publishing an artifact whose import the store doesn't hold answers `MOSTRA_DEP_OFFLINE` naming the package in 155 to 501 ms measured around the protocol call (timer assertion `< 1000 ms`), with no registry request and no install child. An unreachable registry (`127.0.0.1:9`) answers `MOSTRA_DEP_OFFLINE` ("can't be reached") after pnpm's two retries, about 10 s. A postinstall that never ends is stopped at the install limit (4 s in the test, 300 s by default) with `MOSTRA_DEP_TIMEOUT` and leaves no layout | `deps.test.ts` › DP-04; `prove-seeds.ts --only DP-04` | green; seeds (`MOSTRA_OFFLINE` ignored; offline requests sent to the installer instead of the store index) red, green when restored |
| DP-05 | verified | A fixture's postinstall records, while they run, its own PID and its ancestors' PIDs, commands and working directories, and its environment. Its ancestry is the shell pnpm runs it in, pnpm (`pnpm.cjs install --frozen-lockfile`), then the install child (`deps/child/install.js`, IPC-connected), whose parent is the supervisor; the install child and pnpm work in the artifact's source directory; `INIT_CWD` is the lock layout; `HOME` is the artifact environment's; a variable only the supervisor has (`MOSTRA_TEST_SUPERVISOR_ONLY`) and every `MOSTRA_*` variable are absent; a user `.npmrc` with `ignore-scripts=true` doesn't stop it. A SIGKILLed supervisor takes a running postinstall with it, with nothing restarting the home. Unit: the allowlist drops `GITHUB_TOKEN`, `OPENAI_API_KEY`, `NODE_OPTIONS`, `CI` and `MOSTRA_HOME` | `deps.test.ts` › DP-05; `test/unit/deps.test.ts`; `prove-seeds.ts --only DP-05`; Linux in CI (`/proc/<pid>/cwd`) | green on macOS and Linux; seeds (the supervisor's environment passed; the layout as the child's working directory; a user's `ignore-scripts` honored) red, green when restored |

WP-03's checks that this package touched still hold: `ancestors.test.ts` now installs `leftpad-x` from the registry rather than the planted `node_modules` above the home, and refuses a package's undeclared dependency found only there (`prove-seeds.ts --only claude-1`, every seed red, green when restored). The full runtime suites pass: 10 unit files (92 tests) and 11 integration files (110 tests); `pnpm check` is green locally, and CI is green on `b9ca27f` (run [38532578365](https://github.com/mostra-dev/mostra/actions/runs/38532578365); the previous push took 4 min 44 s wall-clock, inside D50's 10-minute target).

## Findings of this session's own checks

- The first DP-01 seed (warm imports installed as on-demand) stayed green: a test that only counted registry requests couldn't see an install from the store. The test now counts install children in the supervisor's log.
- The first seed for "a user's `ignore-scripts`" stayed green: npm and pnpm put `npm_config_userconfig` (the developer's real `~/.npmrc`) into every test process, so the planted `.npmrc` was never read. Test homes now drop `npm_config_*`.
- CodeQL flagged the fake registry's tarball-path regex as polynomial (`js/polynomial-redos`, high); it is parsed without a regex now and the alert is fixed.
- WP-03's confinement only checked imports from the artifact's own files. A package importing a dependency it doesn't declare would have found it in any `node_modules` above the home; it is refused now (`ancestors.test.ts`).

## Independent review (D80)

- **GPT-6.1-Sol** through `codex review --base origin/main` (codex-cli 0.162.1, OpenAI, ChatGPT sign-in), effort high, 2026-10-14, on `b9ca27f`: 2,922,230 input tokens (2,779,776 cached), 13,639 output tokens (6,213 reasoning). A GPT-only run, announced before it started (D34).
- **GitHub Copilot** posted no review on the draft pull request, as on WP-02 and WP-03.
- **CodeQL** flagged one alert (above), fixed.
- No Claude Opus review: D80 keeps it for the truly substantial packages, at most one in five, and WP-03 had the last one.

All six GPT findings held up. Each is fixed with a regression test, and each test was shown red on the old behavior (`node packages/runtime/scripts/prove-seeds.ts --only wp04-review-N`):

| # | Finding | Fix and test |
|---|---|---|
| 1 (P1) | pnpm ran detached with no IPC channel, so a SIGKILLed supervisor left it and its lifecycle scripts running until the next start reaped them | The install child is a small Node entry (`deps/child/install.ts`) started with IPC; it runs pnpm in its own process group and ends that group when its channel disconnects, like the builder child. `deps.test.ts` › "end with the supervisor": a never-ending postinstall is gone within seconds of the SIGKILL, with nothing restarting the home |
| 2 (P2) | A copy that still claims another artifact's ID rewrote that artifact's working lockfile before the commit refused it with `MOSTRA_PUBLISH_ID_CONFLICT` | A resolution returns a `save` step that runs inside the commit's transaction, so a refused publish changes nothing; it also keeps a working lockfile `deps/add` changed in the meantime. `deps.test.ts` › "review finding 2": after the refused copy, the original still publishes under the explicit policy as the same version |
| 3 (P2) | Offline, `pkg@next` or `pkg@nonexistent` silently took the highest stored version | Offline resolution keeps the caller's spec: the supervisor refuses at once only when no stored version can match, and otherwise pnpm resolves it with `--offline` from its metadata cache. `deps.test.ts` › "review findings 3 and 4": a tag the registry never had is `MOSTRA_DEP_NOT_FOUND`, `latest` resolves to its cached version |
| 4 (P2) | Offline, a bare import took a fresh stored release and marked it exact, escaping the release age | Same fix: exactness is the caller's, and pnpm applies the age from cached publish times. Same test: a bare import of a release named exactly elsewhere is `MOSTRA_DEP_NOT_FOUND` ("at least a day old"), with no registry request |
| 5 (P2) | The layout marker was written before the store index, so a crash between them left a complete layout whose packages the index didn't know, and offline requests failed | The index is committed first, then the marker; a crash between them leaves an incomplete layout, removed at the next start. New fault point `deps:before-marker`. `deps.test.ts` › "review finding 5": after a crash there, an offline publish installs from the store |
| 6 (P2) | The CSS scan read `@import` rules inside comments | Comments are blanked (offsets kept, strings untouched) before the scan. `test/unit/deps.test.ts`: commented `@import` and `@plugin` rules are ignored, a `/*` inside a string isn't a comment |

While fixing findings 3 to 5, two tests first failed for a reason of their own: they switched the registry URL to simulate offline, and pnpm's metadata cache is per registry. They now keep the registry, set `MOSTRA_OFFLINE` and assert that no request reaches it (VERIFIED_FACTS, WP-04).

## Agent-facing prose (D74)

Delegated (M15 Q8): the hints and docs pages of the seven DEP codes, the `MOSTRA_HOME_INTEGRITY` hint for a damaged `config.json`, and the additions to `packages/runtime/AGENTS.md` and `packages/warm/AGENTS.md`. None needs Mirza's review before the merge.

## Untested boundaries

- A real offline machine (no network interface) isn't tested; `MOSTRA_OFFLINE` and an unreachable registry are. The interface check is a unit-level rule over `os.networkInterfaces()`.
- A registry that accepts connections and never answers is bounded only by the 300 s install limit, as FAILURE_MODEL §9 says; it isn't `MOSTRA_DEP_OFFLINE`.
- The import scan misses computed specifiers (`import(\`./${x}\`)` of a package); the build then refuses the package with `MOSTRA_BUILD_UNRESOLVED`, and `deps/add` adds it.
- A lock layout counts as complete by its marker; files removed from it afterwards aren't detected until a build fails.
- Lock layouts and the store grow until `mostra gc` collects them (WP-10, written into its specification).
- Native-build lifecycle scripts (`node-gyp`) aren't exercised; the toolchain variables reach them by the allowlist.

## Commits and publication

To be completed after acceptance.

## Next

WP-05, gateway, addressing and hygiene (`docs/design/work-packages/WP-05.md`).
