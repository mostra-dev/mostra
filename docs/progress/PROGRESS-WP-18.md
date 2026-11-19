# WP-18 progress: Kit I, design system, tokens and forms

**Status:** in progress. Owns KT-03, KT-04, KT-05, KT-08 and KT-10 ([specification](../design/work-packages/WP-18.md)), with #158 and #159 on its milestone.

## Baseline

| | |
|---|---|
| Branch | `wp/18-kit`, created from `origin/main` |
| Starting `HEAD` | `d9d8467` (`origin/main`, 2026-11-19: "docs: WP-17's closeout, Mostra 0.17.0, WP-18 next (#213)") |
| `git status` | clean |
| Static jobs | `pnpm check --job format-lint --job types --job build --job boundaries --job api --job docs --job licenses` on `d9d8467`, 2026-11-19: all seven green (format-lint 161 s, types, build and api 97 s, boundaries 58 s, docs 13 s, licenses 3 s) |
| Full baseline | CI's `ci:full` run on this pull request's first commit (a local full `pnpm check` is load-bound on this Mac, as in WP-14 to WP-17) |
| Predecessors | WP-16 ([PROGRESS-WP-16](PROGRESS-WP-16.md)) and WP-17 ([PROGRESS-WP-17](PROGRESS-WP-17.md)) on `origin/main`; no `RECOVERY-WP-18-*.md`; the `WP-18` milestone holds #158 and #159 |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |
