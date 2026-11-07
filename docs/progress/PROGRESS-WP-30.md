# WP-30 progress: remote server and remote MCP

**Status:** In progress. Owns RM-03, MC-04, HY-08, HY-09, HO-09, RM-08 and RM-09 ([specification](../design/work-packages/WP-30.md)), RM-02's external check (D166 item 9), and the issues on the `WP-30` milestone (#129, #132).

## Baseline

| | |
|---|---|
| Branch | `wp/30-remote-server`, created from `origin/main` |
| Starting `HEAD` | `c06bb86` (`origin/main`, 2026-11-07: "docs(design): eight operator questions for WP-30 to settle (#130)") |
| `git status` | clean |
| `pnpm check` | on `c06bb86` in a detached worktree on the external `Active` disk (`/Volumes/Active/mostra-wp28-baseline`, macOS 26.2 arm64, Node 24.22.1, pnpm 12.14.0), after a fresh `pnpm install --frozen-lockfile`: every job passed (format-lint, types, integration, hygiene, e2e, build, boundaries, api, licenses, rust, conformance, docs, commits) but `unit`, in 29 min 37 s. `unit` failed three cases while every job ran at once on this laptop: `gc.test.ts`'s VR-06 property (timed out at 30 s, known under load, MT-02) and two of the CLI's telemetry store cases (`telemetry.test.ts`: "gives processes on a first run one install ID", where five of twelve processes recorded nothing, and "never acts beside a live breaker", where a slow process held the lock). Each file passed alone (35 of 35 and 4 of 4). The telemetry cases are #129's family (a first run's install ID under contention) and are kept for that issue |
| Predecessors | WP-29 done ([PROGRESS-WP-29](PROGRESS-WP-29.md) on `origin/main`); no `RECOVERY-WP-30-*.md` |
| Milestone `WP-30` | #129, #132; #39, #46, #55, #85, #95, #111 and #124 stay on no milestone (D155 item 7), #106 waits for the package that takes it |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |

## Decisions

- **M60** (2026-11-07): Mirza's answers to the session's question set. A test deployment on a server Mirza already runs, on the production names, for claude.ai only (ChatGPT's external check later); GitHub's OAuth app made by him on request; the container image's registry, the operator questions and the plugin's remote server delegated ("I trust you to make the most robust … optimal decision"), with whatever is left for later named explicitly; `@mostra/protocol/operator` ships with this package's release (the managed service's work starts after WP-30). Recorded as D167 with the package's other choices.
