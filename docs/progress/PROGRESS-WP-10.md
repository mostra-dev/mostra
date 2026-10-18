# WP-10 progress: the CLI

**Status:** In progress. This report grows during the session and is finalized after acceptance
(work-packages/README.md §4).

## Baseline

| | |
|---|---|
| Branch | `wp/10-cli`, created from `origin/main` |
| Starting `HEAD` | `b817479` (`origin/main` at session start, 2026-10-17: "docs(progress): finalize the WP-09 report (#28)") |
| `git status` | clean |
| `pnpm check` | uncached (`TURBO_FORCE=true`, 26 min 13 s, macOS arm64): format-lint, types, integration, hygiene, build, boundaries, api, licenses, rust, docs and commits green; two load-bound failures already known from WP-09's report ("Untested boundaries"): `@mostra/protocol`'s `LineSplitter` linear-time test (508 ms against its 500 ms bound) in `unit`, and one Firefox test in `e2e` (`client.spec.ts`, IN-03, timed out). Each passes run alone: `pnpm --filter @mostra/protocol test` 226 of 226, `playwright test specs/client.spec.ts --project firefox` 9 of 9 |
| Predecessors | WP-09 done ([PROGRESS-WP-09](PROGRESS-WP-09.md) on `origin/main`); no `RECOVERY-WP-10-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, macOS 26.2 arm64 |
