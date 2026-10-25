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
