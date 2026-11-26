# WP-24 progress: Web demos and exports

**Status:** in progress. Owns TM-08 and VR-07 ([specification](../design/work-packages/WP-24.md)); the
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
