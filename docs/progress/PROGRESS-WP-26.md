# WP-26 progress: Templates, gallery and documentation site

**Status:** in progress. Owns AU-06, AX-07, EN-03, KT-09, RS-02 and LL-06 ([specification](../design/work-packages/WP-26.md)). No `WP-26` milestone exists on GitHub, so no open issue is on it.

## Baseline

| | |
|---|---|
| Branch | `wp/26-templates-gallery-docs`, created from `origin/main` |
| Starting `HEAD` | `0e82bfb6` (`origin/main`, 2026-11-28: "docs: WP-24's closeout, Mostra 0.21.0, WP-25 and WP-26 next (#265)") |
| `git status` | clean |
| Static jobs | `pnpm check --job format-lint --job types --job build --job boundaries --job api --job docs --job licenses` on `0e82bfb6`, 2026-11-28: every job green |
| Full baseline | CI's `ci:full` run on this pull request's first commit (a full local `pnpm check` is load-bound on this Mac, as in WP-14 to WP-24) |
| Predecessors | WP-24 ([PROGRESS-WP-24](PROGRESS-WP-24.md)) on `origin/main`; WP-25 runs beside this package (D184); no `RECOVERY-WP-26-*.md` |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64; the checkout is on the external volume `Active` (#106 applies to a released bundle's cache there, not to the workspace's own runtime) |
