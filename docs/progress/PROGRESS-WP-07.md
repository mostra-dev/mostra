# WP-07 progress: client runtime and shell controls

**Status:** In progress. This report grows during the session and is finalized after acceptance (work-packages/README.md §4).

## Baseline

| | |
|---|---|
| Branch | `wp/07-client-runtime`, created from `origin/main` |
| Starting `HEAD` | `f7b41b6` (`origin/main` at session start, 2026-10-15: "docs(progress): finalize the WP-06 report (#19)") |
| `git status` | clean |
| `pnpm check` | green: format-lint, types, unit, integration, hygiene, e2e, build, boundaries, api, licenses, rust, docs and commits all pass, uncached (`TURBO_FORCE=true`, 4 min 18 s, macOS arm64) |
| Predecessors | WP-06 done ([PROGRESS-WP-06](PROGRESS-WP-06.md) on `origin/main`); no `RECOVERY-WP-07-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, macOS 26.2 arm64 |
