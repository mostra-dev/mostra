# WP-29 progress: remote transport and relay

**Status:** In progress. Owns RM-01, RM-02, RM-04 and RM-07 ([specification](../design/work-packages/WP-29.md)), and the issues on the `WP-29` milestone (#114, #116, #118, #119).

## Baseline

| | |
|---|---|
| Branch | `wp/29-remote-relay`, created from `origin/main` |
| Starting `HEAD` | `a6f974f` (`origin/main`, 2026-11-05: "docs: WP-28's closeout, WP-29 next (#127)") |
| `git status` | clean |
| `pnpm check` | green on `a6f974f` in a detached worktree on the external `Active` disk (`/Volumes/Active/mostra-wp28-baseline`, macOS 26.2 arm64, Node 24.22.1, pnpm 12.14.0): every job passed (format-lint, types, unit, integration, hygiene, e2e, build, boundaries, api, licenses, rust, conformance, docs, commits) in 27 min 35 s of wall time, after a fresh `pnpm install --frozen-lockfile`. No failure was already present |
| Predecessors | WP-28 done ([PROGRESS-WP-28](PROGRESS-WP-28.md) on `origin/main`); no `RECOVERY-WP-29-*.md` |
| Milestone `WP-29` | #114, #116, #118, #119; #39, #46, #55, #85, #95, #111 and #124 stay on no milestone (D155 item 7), #106 waits for the package that takes it |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |

## Decisions

(Recorded as they are taken.)

## Evidence

The evidence table (one row per owned requirement, work-package protocol §3) is added as each check passes.
