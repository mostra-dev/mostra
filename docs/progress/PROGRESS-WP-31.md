# WP-31 progress: teams

**Status:** In progress. Owns CO-01, CO-02, CO-03, CO-04, CO-05 and CO-07 ([specification](../design/work-packages/WP-31.md)), and the issues on the `WP-31` milestone (#132, #135).

## Baseline

| | |
|---|---|
| Branch | `wp/31-teams`, created from `origin/main` |
| Starting `HEAD` | `9215aeb` (`origin/main`, 2026-11-10: "docs: WP-30's closeout, Mostra 0.11.0, WP-31 next (#137)") |
| `git status` | clean |
| `pnpm check` | on `9215aeb` in a detached worktree on the external `Active` disk (`/Volumes/Active/mostra-wp31-baseline`, macOS 26.2 arm64, Node 24.22.1, pnpm 12.14.0), after a fresh `pnpm install --frozen-lockfile`: format-lint, types, hygiene, e2e, build, boundaries, api, licenses, rust, docs and commits passed; `unit`, `integration` and `conformance` failed while every job ran at once and the laptop's internal disk filled up (2.7 GiB free at the start; `disk I/O error` in the conformance kit's homes, the npm bootstrap's bundle install, the Rust gate seeds), beside the known load timeouts (`gc.test.ts`'s VR-06 and the fields property, MT-02). The three jobs re-run alone once space was freed: see below |
| Predecessors | WP-30 ([PROGRESS-WP-30](PROGRESS-WP-30.md)) and WP-07 ([PROGRESS-WP-07](PROGRESS-WP-07.md)) on `origin/main`; no `RECOVERY-WP-31-*.md` |
| Milestone `WP-31` | #132, #135; #39, #46, #55, #85, #95, #111 and #124 stay on no milestone (D155 item 7) |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |
