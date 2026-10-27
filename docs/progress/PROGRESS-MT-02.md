# MT-02 progress: the open issues, CI's cache gap and Renovate's updates

**Status:** In progress. A maintenance unit between WP-W3 and WP-13, approved by Mirza on 2026-10-26 (M42, D154). It owns no requirement of its own; the checks it adds extend their owners' rows. Its scope is the GitHub milestone `MT-02`: the flake issues #35, #39, #46, #55, #66 and #85, CI's cache gap #86, the first install's time on Windows arm64 #88, and Renovate's open updates #80 to #84. Done when the milestone is empty and a full CI run (`ci:full`, every leg) and the merge queue are green.

## Baseline

| | |
|---|---|
| Branch | `mt/02-issues`, created from `origin/main` |
| Starting `HEAD` | `484a9e9` (`origin/main`, 2026-10-27: "docs: WP-W3's closeout, D154 and MT-02, Mostra 0.6.0 (#89)") |
| `git status` | clean |
| `pnpm check` | 23 min 38 s on macOS arm64, on a clean checkout of `484a9e9`. Green: format-lint, types, unit, hygiene, e2e, build, boundaries, api, licenses, rust, conformance, docs and commits. One failure: `integration`, `dev.test.ts` "takes an editor's save that moves the old file aside…" ("Timed out waiting for a sync in the gap"), a 900 ms wait the loaded machine missed (fixed here, under #35) |
| Predecessors | WP-W3 done ([PROGRESS-WP-W3](PROGRESS-WP-W3.md) on `origin/main`); no `RECOVERY-MT-02-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, macOS 26.2 arm64. Windows behavior is observed only on GitHub's runners |
| Disk | Freed from 2.9 GB to 17 GB at the start, at Mirza's request: old release smokes in `/tmp` (WP-W1 to WP-W3), 1,476 test homes, earlier Mostra scratch, the Cargo `target/`, Playwright revisions no longer pinned, the bundle cache and the pnpm store's unreferenced packages |

## Issues

| Issue | State |
|---|---|
| #35 | Root cause found and fixed (below) |
| #86 | Root cause found and fixed (below) |
| #39, #46, #55, #66, #85, #88 | In progress |
| #80 to #84 | In progress |
