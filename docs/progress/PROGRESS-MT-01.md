# MT-01 progress: CI, Blacksmith runners, Renovate and the open issues

**Status:** In progress. A maintenance unit between WP-W2 and WP-W3, approved by Mirza on 2026-10-24 ("I absolutely approve/accept all of your decisions"). It owns no requirement of its own: it re-checks EN-07 (WP-01's row, CI under 10 minutes for a typical pull request), lands the open Renovate updates and closes or schedules the open issues. Its decision is D152.

## Baseline

| | |
|---|---|
| Branch | `mt/01-ci`, created from `origin/main` |
| Starting `HEAD` | `0836e57` (`origin/main`, 2026-10-24: "docs(progress): WP-W2's closeout after the report (#73)") |
| `git status` | clean |
| `pnpm check` | 33 min 5 s on macOS arm64. Green: format-lint, types, unit, hygiene, e2e, build, boundaries, api, licenses, rust, conformance, docs and commits. One failure: `integration`, the runtime's RT-03 backoff-and-park test (`lifecycle.test.ts`, timed out after 32 s), the known load flake #42 |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, macOS 26.2 arm64; Blacksmith CLI 0.5.3 |

## CI before this unit (measured 2026-10-24, GitHub's API)

One week, 2026-10-17 to 2026-10-24: 744 workflow runs and about 38,800 job-minutes (Linux x64 13,400, macOS 11,850, Windows arm64 8,340, Windows x64 4,700, Linux arm64 480).

| Finding | Evidence |
|---|---|
| Waiting for a runner dominates wall-clock. The organization's Free plan runs 20 jobs at once (5 macOS), shared by every workflow; a full CI run is 53 jobs, Release 13 (5 macOS), CodeQL 3 | A docs-only pull request used 4.3 job-minutes and took 39.5 min, 24 of them queued (run 40136168379). A fix pull request took 45.5 min for 257 job-minutes; its plan job alone waited 13.3 min (run 40128880738). WP-W2's last full run: 25.7 min wall, 246.7 job-minutes, its last jobs queued 9 to 10 min (run 40092846097) |
| Renovate spent 35% of all minutes (13,456 a week) | `main` requires up-to-date branches, so Renovate's `rebaseWhen: auto` rebases its three open security pull requests on every push to `main`, and each rebase runs CI, Release and CodeQL in full |
| The release rehearsal ran on every package-touching pull request | 4,323 job-minutes a week, 2,757 of them macOS |
| Redundant runs | every merge forced open pull requests to update and run again, then `main` ran all 53 jobs again; unaffected matrix legs each started a runner just to skip (10 on a docs-only pull request) |
| Windows arm64 setup took about 6 of 12 minutes | `pnpm install` 3 min 40 s and the store's restore 1 min 20 s (run 40092846097, job 120869263962) |
| The cache was full: 10.5 GB of 10 GB | Playwright browsers keyed by the whole lockfile (4.5 GB in 27 entries) and the pnpm store saved per pull request (4.5 GB), each dependency pull request saving another 1.5 GB of browsers and evicting `main`'s |
| Flaky tests cost reruns | #55, #42, #35, #66 |

## What was built

- **One plan for every CI run** (D152 items 1, 5). `tools/check/ci.ts` and `tools/check/matrix.ts` turn the event (a pull request, its draft state, author and labels as they are now, the merge queue, the nightly run, a run by hand) and `pnpm check`'s own plan into each job's legs; a job no change needs gets no runner, and the cheap checks share one machine (`static`). Pull requests run Linux, macOS (WebKit only for e2e, and at most five macOS legs, since GitHub runs five macOS jobs at once on every plan) and Windows x64; `ci:full`, the merge queue and the nightly run add Windows arm64, macOS's Chromium and Firefox and any macOS leg past five. A bot's draft runs nothing. `ci-ok` waits for every job and fails when the plan fails.
- **Blacksmith for Linux, GitHub as the fallback** (D152 item 3). `.github/actions/runners` reads Blacksmith's status page and, with its pinned CLI (0.5.3, SHA-256 checked), its usage over the last 31 days, before anything of the repository is installed; `tools/check/runners.ts` chooses, and every doubt chooses GitHub. `CI_RUNNERS`, `BLACKSMITH_BUDGET` (default 6000 billing minutes, the free 3,000 2-vCPU minutes) and `BLACKSMITH_THRESHOLD` (0.9) are repository variables.
- **The release rehearsal moved into CI** (D152 item 4, #69). `release-build.yml` is called by CI (linux-x64 for a package change, every platform for distribution files, the queue and full runs) and by `release.yml`, which runs only on `main` to publish a version that is due. `versions.ts plan` rehearses the next patch when nothing is pending and npm has the tree's version.
- **A merge queue instead of up-to-date branches** (D152 item 2): `.github/rulesets/main.json` (applied at the merge, see "Publication").
- **Balanced machines** (D152 item 5): the macOS and Linux integration groups run their suites one file at a time, so `dev` joined `verify` and the publish-fault and worker-lifecycle suites joined `verify-failures` (a unit test keeps them a partition); Windows' slowest end-to-end engines (Firefox on x64, emulated Chromium on arm64) run in two parts each (`MOSTRA_E2E_SHARD`).
- **Caches** (D152 item 7): the pnpm store on the workspace's drive, keyed by OS image and lockfile; each Playwright browser by its version; apt downloads; Turbo's per-job caches and cargo's; all saved only on `main` (a test of `ci.yml` and the composite actions holds it).
- **Renovate** (D152 item 6): drafts, rebases on conflicts only, the bundle's pnpm kept below 11. **Outside contributors** need approval for every run (item 8, applied live). The `ci:full` label exists.
- **The three security updates** (#38, #60, #63): Vite 8.3.3, Zod 4.6.6, undici 8.12.2, through the catalogs with a changeset, the workspace file's comments kept, no release-age exceptions.
- **Issues fixed:**
  - **#17**: the JSON-RPC core carries only the six HOST codes it raises (`codes/host-core.ts`): the core from 5.79 to 3.84 kB, its budget from 6 to 5 kB, the bridge's from 8.75 to 7.5 kB; this is what lets Zod 4.6.6 fit `@mostra/react`'s budget.
  - **#42**: a parked worker's live sources all report the park; a source whose producer was still starting at the last crash got a generic failure or none. The test also counts each crash instead of catching a 100 ms backoff.
  - **#45**: `receivable(schema)` in `@mostra/protocol`; `RpcPeer.call` reads results, and the SDK its port requests and event pages, accepting the enum values and union members a newer peer adds (D152 item 9).
  - **#69**: as above.
- **Windows' telemetry install-ID race** (WP-W2's #72 follow-up). A temporary probe traced every lost ID to Windows refusing to rename over `telemetry.json` while another process had it open (EPERM); the settings and queue are now replaced with retries for up to a second, as the runtime's renames are. The lock also tells contention from an unwritable directory with a probe file instead of counting rounds. The race test's processes now say what they read when they get no ID.
- **Diagnostics for #35 and #55**: the POSIX integration legs keep their test homes' supervisor logs when they fail, as the Windows legs did.
- **Found by the measurements:** a pull request's linux-x64-only rehearsal couldn't pin its bundle (`pins.ts` wanted all four; a rehearsal now names the platforms it built, a release still needs all four), and the first Blacksmith budget read the free month as 3,000 billing minutes where Blacksmith's CLI counts 6,000.
- **Docs:** D152 and M39; REPO_STANDARDS §2, §6, §9, §10; `docs/agents/run-ci.md` (new) and `release.md`; the protocol's AGENTS.md; INTERFACES' revisions rule; VERIFIED_FACTS (MT-01); the root AGENTS.md points to `run-ci.md`; WP-W3's specification takes the CI handoff and WP-13's checks #35 and #55 at its baseline (generator).

## Evidence

MT-01 owns no requirement (D152). Its own checks are below; the ones that extend an earlier package's requirement say which, and that row stays with its owner. CI runs are on GitHub, Blacksmith usage from Blacksmith's CLI, both external.

| Check | State | How | Result |
|---|---|---|---|
| A typical pull request finishes under 10 minutes (EN-07, WP-01's row) | verified | #76, a one-line comment in `@mostra/runtime` against #75's branch, measured by its jobs' timestamps | 8.3 min wall, 121 job-minutes, every job started within 1 min, green (CI run 40192461607). Before MT-01, such a pull request took 45.5 min and 257 job-minutes (run 40128880738); on #76's way down, 11.0 (40188774491), then 9.9 (40189921325) |
| A full run (everything, every leg) | verified | #75 with `ci:full` | 59 jobs, 20.9 min, green at the first attempt (CI run 40190881472); bounded by GitHub's five macOS jobs at once (about 71 macOS job-minutes, the Intel bundle's 10 min among them) |
| What runs when, and where (D152 items 1, 2, 5) | validated | `tools/test/ci.test.ts` (20 tests) through `ciScope`, `ciMatrix` and the workflow's YAML; EN-07 seeds through `prove-seeds.ts --only EN-07` | 11 seeds, each red planted and green restored: a fork's run on Blacksmith, Blacksmith past its budget, an outage the status page reports ignored, a bot's draft running CI, the queue checking GitHub's merge commits, a nightly repeating a passed commit, `ci-ok` skipping a failed plan, CI on a push to `main`, the rehearsal over a version npm has (#69), more than five macOS legs on a pull request, a POSIX suite in two groups |
| The runner choice and its fallback, live (D152 item 3) | verified | Repository variable `BLACKSMITH_BUDGET=100`, then a run by hand | The plan read the real 31-day usage through the pinned CLI and chose GitHub: "1842 of 100 billing minutes in 31 days, at or past 90" (CI run 40193210475, cancelled after its plan; the variable removed). Every other run of #74 to #76 chose Blacksmith (`blacksmith-2vcpu-ubuntu-2604`, `-4vcpu-`) |
| Blacksmith stays within its free month | validated | `blacksmith usage --since 30d` | 1,842 billing minutes of 6,000 after all of MT-01's runs (187 jobs, $3.684 list, nothing billed); about 150 a run, so roughly 40 runs a month, then GitHub's runners |
| The release rehearsal in CI (EN-05, WP-11's row; D152 item 4) | verified | #75's and #76's runs | linux-x64 alone for a package change (#76: bundle, smoke, pins of that one bundle, pack, npm dry run, npm path), all four platforms in full runs (#75), each green. `release.yml` on `main` is untested until the next release (see "Untested boundaries") |
| #69 | validated | `tools/test/versions.test.ts` through `rehearsal()` with npm stubbed; an EN-07 seed; #75's and #76's rehearsals | No changeset pending and npm holding the tree's version: the next patch (red planted, green restored). In CI, #75's changesets were pending, so the rehearsal built their version, 0.5.0, and its npm dry run passed. A pull request with nothing pending meets it first after the next release, when `main` has no changeset left |
| #17 | verified | `pnpm --filter @mostra/protocol size`; the whole-HOST import restored by hand | The JSON-RPC core 3.84 kB with #17's fix, 4.36 kB with #45's `receivable` added (budget 5 kB), against 5.79 kB with the old import; the bridge 7.06 of 7.5 kB; `@mostra/react` with Zod 4.6.6 at 51.58 of 53.5 kB |
| #42 (RT-03, WP-08's row) | verified | `test/unit/live.test.ts`; `lifecycle.test.ts`; RT-03 seeds | A source still starting at the last crash reports `MOSTRA_RUNTIME_WORKER_PARKED`; seeds red and green; the park test green on every leg of #75's full runs, Windows x64 included after its crash-count check |
| #45 (HO-07, WP-01's invariant row) | verified | `packages/protocol/test/receive.test.ts`, including a real `RpcPeer.call`; two HO-07 seeds | Unknown enum values and union members arrive, every other check holds, every registered result and notification schema opens; seeds red and green |
| The telemetry install-ID race on Windows (RT-11, WP-W2's row) | verified | A temporary probe workflow repeating the race test 15 times per runner; the retry's unit tests; an RT-11 seed | Before: 7 of 15 runs lost IDs on x64, each traced to `EPERM` renaming over `telemetry.json`. After: 0 of 15 on x64 and 0 of 15 on arm64 (run 40153733859), and green on every Windows leg since; seed red and green |
| The security updates (#38, #60, #63) | verified | `pnpm install --frozen-lockfile`, the license audit, size budgets, every CI leg | Vite 8.3.3, Zod 4.6.6, undici 8.12.2 in the catalogs; green on every leg of #75 |
| Outside contributors' approval, the `ci:full` label (D152 item 8) | verified | `gh api …/actions/permissions/fork-pr-contributor-approval`; `gh label list` | `all_external_contributors`; `ci:full` exists. `tools/github/settings.ts verify` reports only the merge-queue ruleset, applied at the merge |
| Caches saved only on `main` (D152 item 7) | plausible | `tools/test/ci.test.ts` over `ci.yml` and the composite actions; an EN-07 seed; `gh cache list` | No pull request of #74 to #76 saved a pnpm store, browser, apt or cargo cache (all 60 such entries are `main`'s or the old workflow's Renovate runs'); they did save 295 Turbo entries (937 MB), which led to Turbo's restore-then-save-on-main; that `main`'s nightly run saves and pull requests restore is first observed after the merge |

**Locally**, `pnpm check` on the final tree (`843eb06`, macOS arm64) took 27 min 22 s: every job green but e2e, where two WebKit action tests (`actions.spec.ts:60`, `:101`) ran past their time beside the other jobs' processes; WebKit's e2e alone right after: green in 125 s. As in WP-07's to WP-W2's baselines, a full local run loads one laptop with what CI spreads over 59 machines.

**Each `pnpm check` gate** ran green on #75's full runs, last on the final tree (CI run 40194345859: 59 jobs, 16.0 min, green at the first attempt): static (format-lint, types, build, boundaries, api, licenses, docs, commits), unit, hygiene, integration (macOS, Linux and Windows groups), e2e (every engine and leg), rust, conformance and the release rehearsal.

## Reviews (D80)

- **My review of the diff**, during the work and against the final state: the measurements found two defects (the subset rehearsal's pins, the budget's unit), both fixed with tests; the CI and release workflows were re-read against the old ones for permissions, concurrency, finish mode and the order release-then-npm.
- **GPT-6.1-Sol** through `codex review --base origin/main` (OpenAI, ChatGPT sign-in, codex-cli 0.162.1), effort high, on 2026-10-25 against `d1c60a5`: 3,980,763 input tokens (3,816,960 cached) and 9,268 output (4,530 reasoning). A GPT-only run, announced first (D34). Two findings, both valid, both reproduced by the reviewer and fixed with a test red on the old code and a seed red planted and green restored:
  1. (P2) `receivable` cleared every object's catchall, so a loose object stopped passing its fields through: the bridge's `ui/initialize` host context (MCP Apps' `safeAreaInsets`, which `BridgeHostContext` allows) reached the page without them. Only a strict object's `never` catchall is relaxed now; a loose one keeps passing fields through and a typed one keeps checking them. Test: `receive.test.ts` "keeps what a loose object passes through"; seed HO-07.
  2. (P2) A worker that failed six times before answering `worker/start` parked with no live source named (the live module never learned them), and #42's guard then silenced the start's own failure, so the source never said it was parked. The park now records its cause, and a start the park cut short reports the park for its own source unless that source already says so. Test: `live.test.ts` "never started at all"; seed RT-03; `lifecycle.test.ts`'s park test green on the fix.
- **Claude Opus 5.5** (D144): pending; Mirza runs it from the prompt the session wrote.
- **Copilot**: no review (its quota).

## Untested boundaries

- **The merge queue itself.** Its ruleset is applied at #75's merge, and #75 is the first pull request through it; `merge_group` runs are proven only by the plan's tests until then.
- **`release.yml` on `main`.** It calls `release-build.yml` with every platform and then publishes; the rehearsal exercises the same reusable workflow on every platform, but a real publish waits for the next release.
- **The nightly run** and its skip of a commit that already passed: tested in the plan, first run on `main` the night after the merge.
- **Caches** saved by `main` and restored by pull requests (above).
- **Blacksmith's own month boundary.** The window is a rolling 31 days, so Linux jobs return to Blacksmith only once the last 31 days are under the threshold, whatever day Blacksmith's month starts; that can leave free minutes unused, never pay for any.
- **Merge-queue latency** is bounded by GitHub's five macOS jobs at once (about 21 min for a full run); GitHub Team raises the total limit from 20 to 60 jobs, not the macOS one.

## Deviations

- **#74 closed, continued in #75**: one commit's subject was 107 characters, over the commits gate's 100, and history is never rewritten. #75 carries the same tree with that commit's subject shortened and the later commits re-applied (`cherry-pick -x`).
- **Two temporary branches**: `probe/mt01-telemetry` (the Windows probe) and `probe/mt01-typical` (#76, the typical pull request). Neither merges.
- **D152 item 5 grew while measuring**: the five-macOS-legs budget, the balanced groups and the Windows shards came from #76's runs, not from the plan Mirza approved; they change no requirement and keep every leg in the merge queue.

## Issues

| Issue | Disposition |
|---|---|
| #17, #42, #45, #69 | Fixed here; closed by the merge |
| #38, #60, #63 | Landed here through the catalogs; Renovate closes them once `main` has the versions |
| #66 | WP-W3, as its specification says (the disk measurement first); MT-01's Windows x64 stalls added to it |
| #35, #55 | WP-13 checks them at its baseline (its specification), with the supervisor logs failed legs now keep |
| #39, #46 | Kept open for the next occurrence; their diagnostics are in place |
| #4 | Renovate's Dependency Dashboard; stays |
