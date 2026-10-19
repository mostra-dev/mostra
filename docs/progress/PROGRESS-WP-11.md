# WP-11 progress: distribution, the runtime bundle, the SDK and the release pipeline

**Status:** In progress.

## Baseline

| | |
|---|---|
| Branch | `wp/11-distribution`, created from `origin/main` |
| Starting `HEAD` | `b9c6030` (`origin/main` at branch time, 2026-10-19: "docs(design): add Studio, the kit's default theme (D141) (#36)") |
| `git status` | clean |
| `pnpm check` | uncached (`TURBO_FORCE=true`, about 25 min, macOS arm64): all 13 jobs green (format-lint, types, unit, integration, hygiene, e2e, build, boundaries, api, licenses, rust, docs, commits) |
| Predecessors | WP-10 done ([PROGRESS-WP-10](PROGRESS-WP-10.md) on `origin/main`); no `RECOVERY-WP-11-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, macOS 26.2 arm64 |

**Before the branch.** Mirza asked that the package wait for PR #30 (D141). Its Linux checks failed because `ubuntu-latest` moved to Ubuntu 26.04 on 2026-10-19. The Playwright and Turborepo caches were keyed by `runner.os`, so WebKit built for Ubuntu 24.04 was restored onto 26.04 and couldn't load `libicudata.so.74`. Fixed in #34 (the caches are keyed by the OS release and architecture) and merged. #30's branch then gained an unsigned merge commit from GitHub's "Update branch" button, which the `commits` gate refuses. History can't be rewritten, so #36 carried the same content from #30's last head with a signed merge, and merged as `b9c6030`. A `mostra dev` failure seen once on Ubuntu 26.04 (the suite's instance lost while a `dev/start` was aborted; its re-run passed) is issue #35.
