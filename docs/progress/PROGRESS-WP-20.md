# WP-20 progress: Review layer and shell design

**Status:** in progress. Owns RV-01, RV-02, RV-03, RV-04, RV-05, SH-05, SH-06, CO-06 and HO-11
([specification](../design/work-packages/WP-20.md)), with #85, #152, #167, #188, #194 and #218 on
its milestone.

## Baseline

| | |
|---|---|
| Branch | `wp/20-review`, created from `origin/main` |
| Starting `HEAD` | `ef882eb7` (`origin/main`, 2026-11-23: "docs: WP-18's closeout, Mostra 0.19.0, WP-19 next (#243)") |
| `git status` | clean |
| Static jobs | `pnpm check --job format-lint --job types --job build --job boundaries --job api --job docs --job licenses` on `ef882eb7`, 2026-11-23: types, build, boundaries, api and licenses green; format-lint and docs red in that run only, each green alone right after (`biome ci .`: no error; `node tools/docs/diagnostics.ts check`: 209 codes, each with a current page). The docs check read `@mostra/protocol`'s `dist/` while the parallel build was writing it, and biome met a file a test was writing at the moment it scanned; nothing is wrong on `main` |
| Full baseline | CI's `ci:full` run on this pull request's first commit (a full local `pnpm check` is load-bound on this Mac, as in WP-14 to WP-18) |
| Predecessors | WP-07 ([PROGRESS-WP-07](PROGRESS-WP-07.md)) and WP-18 ([PROGRESS-WP-18](PROGRESS-WP-18.md)) on `origin/main`; no `RECOVERY-WP-20-*.md`; the `WP-20` milestone holds #85, #152, #167, #188, #194 and #218 |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |
