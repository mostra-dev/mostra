# WP-04 progress: dependencies

**Status:** In progress. The report grows during the session and is finalized after acceptance (work-packages/README.md §4).

## Baseline

| | |
|---|---|
| Branch | `wp/04-deps`, created from `origin/main` |
| Starting `HEAD` | `34ab3b6fb1c9ed6c3964a65b517ded630faefbb0` (`origin/main` at session start, 2026-10-13: "docs(progress): finalize the WP-03 report (#11)") |
| `git status` | clean |
| `pnpm check` | red in one job: `unit` failed in `tools/test/gates.test.ts` with `rsync failed: … packages/runtime/dist/bin.d.ts: … No such file or directory`. The gate tests copy the working tree, `dist/` included, while the parallel `build` task rewrites `packages/runtime/dist`. `pnpm check --job unit` alone passes (159 s). Every other job passed: format-lint, types, integration, build, boundaries, api, licenses, rust, docs, commits (3 min 44 s, macOS arm64) |
| Predecessors | WP-03 done ([PROGRESS-WP-03](PROGRESS-WP-03.md) on `origin/main`); no `RECOVERY-WP-04-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, macOS arm64 |
| Pull request | draft, opened with this baseline |
