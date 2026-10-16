# WP-08 progress: workers, actions and live data

**Status:** In progress. The report grows during the session and is finalized after acceptance
(work-packages/README.md §4).

## Baseline

| | |
|---|---|
| Branch | `wp/08-workers-actions`, created from `origin/main` |
| Starting `HEAD` | `b0da907` (`origin/main` at session start, 2026-10-16: "docs(design): the plan update of 2026-10-16 (D116 to D128, WP-28 to WP-32) (#23)") |
| `git status` | clean |
| `pnpm check` | uncached (`TURBO_FORCE=true`, 12 min 9 s, macOS arm64): every job green except `e2e`, where 5 Firefox tests timed out while every job ran in parallel (`client.spec.ts` IN-02 and IN-03, `controls.spec.ts` Claude review finding 6); `pnpm check --job e2e` alone then passed (309 s). Load-dependent, recorded as a baseline failure, not caused by this package |
| Predecessors | WP-06 and WP-07 done ([PROGRESS-WP-06](PROGRESS-WP-06.md), [PROGRESS-WP-07](PROGRESS-WP-07.md) on `origin/main`); no `RECOVERY-WP-08-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, macOS 26.2 arm64 |
| Open issues for this package | [#8](https://github.com/mostra-dev/mostra/issues/8) (macOS start-time resolution, "to fix in WP-08") |
