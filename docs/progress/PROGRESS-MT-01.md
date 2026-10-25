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

- **One plan for every CI run** (D152 items 1, 5). `tools/check/ci.ts` and `tools/check/matrix.ts` turn the event (a pull request, its draft state, author and labels as they are now, the merge queue, the nightly run, a run by hand) and `pnpm check`'s own plan into each job's legs; a job no change needs gets no runner, and the cheap checks share one machine (`static`). Pull requests run Linux, macOS (WebKit only for e2e) and Windows x64; `ci:full`, the merge queue and the nightly run add Windows arm64 and macOS's Chromium and Firefox. A bot's draft runs nothing. `ci-ok` waits for every job and fails when the plan fails.
- **Blacksmith for Linux, GitHub as the fallback** (D152 item 3). `.github/actions/runners` reads Blacksmith's status page and, with its pinned CLI (0.5.3, SHA-256 checked), its usage over the last 31 days, before anything of the repository is installed; `tools/check/runners.ts` chooses, and every doubt chooses GitHub. `CI_RUNNERS`, `BLACKSMITH_BUDGET` and `BLACKSMITH_THRESHOLD` are repository variables.
- **The release rehearsal moved into CI** (D152 item 4, #69). `release-build.yml` is called by CI (linux-x64 for a package change, every platform for distribution files, the queue and full runs) and by `release.yml`, which runs only on `main` to publish a version that is due. `versions.ts plan` rehearses the next patch when nothing is pending and npm has the tree's version.
- **A merge queue instead of up-to-date branches** (D152 item 2): `.github/rulesets/main.json` (applied at the merge, see "Publication").
- **Caches** (D152 item 7): the pnpm store on the workspace's drive, keyed by OS image and lockfile; each Playwright browser by its version; apt downloads; all saved only on `main`.
- **Renovate** (D152 item 6): drafts, rebases on conflicts only, the bundle's pnpm kept below 11. **Outside contributors** need approval for every run (item 8, applied live). The `ci:full` label exists.
- **The three security updates** (#38, #60, #63): Vite 8.3.3, Zod 4.6.6, undici 8.12.2, through the catalogs with a changeset, the workspace file's comments kept, no release-age exceptions.
- **Issues fixed:**
  - **#17**: the JSON-RPC core carries only the six HOST codes it raises (`codes/host-core.ts`): the core from 5.79 to 3.84 kB, its budget from 6 to 5 kB, the bridge's from 8.75 to 7.5 kB; this is what lets Zod 4.6.6 fit `@mostra/react`'s budget.
  - **#42**: a parked worker's live sources all report the park; a source whose producer was still starting at the last crash got a generic failure or none. The test also counts each crash instead of catching a 100 ms backoff.
  - **#45**: `receivable(schema)` in `@mostra/protocol`; `RpcPeer.call` reads results, and the SDK its port requests and event pages, accepting the enum values and union members a newer peer adds (D152 item 9).
  - **#69**: as above.
- **Windows' telemetry install-ID race** (WP-W2's #72 follow-up). A temporary probe traced every lost ID to Windows refusing to rename over `telemetry.json` while another process had it open (EPERM); the settings and queue are now replaced with retries for up to a second, as the runtime's renames are. The lock also tells contention from an unwritable directory with a probe file instead of counting rounds. The race test's processes now say what they read when they get no ID.
- **Diagnostics for #35 and #55**: the POSIX integration legs keep their test homes' supervisor logs when they fail, as the Windows legs did.
- **Docs:** D152 and M39; REPO_STANDARDS §2, §6, §9, §10; `docs/agents/run-ci.md` (new) and `release.md`; the protocol's AGENTS.md; INTERFACES' revisions rule; VERIFIED_FACTS (MT-01); WP-W3's specification (generator) takes the handoff.
