# WP-17 progress: MCP Apps export

**Status:** In progress. Owns MC-02 and MC-03 ([specification](../design/work-packages/WP-17.md)), with #139 and #157 on its milestone.

## Baseline

| | |
|---|---|
| Branch | `wp/17-mcp-apps`, created from `origin/main` |
| Starting `HEAD` | `8165633` (`origin/main`, 2026-11-16: "docs: the test deployment is retired; candidates are checked on the hosted service (#170)"), merged through the merge queue at this session's start with Mirza's go (M74) |
| `git status` | clean |
| `pnpm check` | on `8165633` in place, 2026-11-16, with Cargo's target directory on the external disk: the full run reached its 50-minute deadline (`--deadline 50`) still running, on a Mac shared with other sessions' builds and tests; the static jobs then ran alone (below), and the full baseline is CI's `ci:full` run on this pull request (below) |
| Static jobs (format-lint, types, build, boundaries, api, docs, licenses) | `pnpm check --job format-lint --job types --job build --job boundaries --job api --job docs --job licenses`: all seven green (28.7 s, Turborepo's cache warm from the full run) |
| CI baseline | the `ci:full` run on this pull request's first commit (every job on every leg); its result is recorded when it ends |
| Predecessors | WP-16 done ([PROGRESS-WP-16](PROGRESS-WP-16.md)) on `origin/main`, released as Mostra 0.15.1; no `RECOVERY-WP-17-*.md`; the `WP-17` milestone holds #139 and #157 |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |

## Decisions with Mirza

- **2026-11-16T10:45Z (M74)**, his answers to the session's first questions: merge #170 before branching ("I agree with you, let's merge it"); waits are chained at most 51 minutes each; nothing installed for the external checks (VS Code and the rest) until he sets them up at the end; and every other question delegated: "I trust you to make the most robust, appropriate, high-quality … decisions". Recorded as **D175**.
