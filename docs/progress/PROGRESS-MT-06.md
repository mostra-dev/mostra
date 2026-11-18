# MT-06 progress: signing out

**Status:** In progress. A maintenance unit beside WP-17 ([specification](../design/work-packages/MT-06.md)); it owns no requirement of its own (D152), and the checks it adds extend HY-08's (sign-in and sessions) and MC-04's (the authorization server) rows. Its scope is the GitHub milestone `MT-06`: #204 (signing out) and #203 (the metering window).

## Baseline

| | |
|---|---|
| Branch | `mt/06-sign-out`, created from `origin/main` |
| Starting `HEAD` | `41d0c27` (`origin/main`, 2026-11-18: "docs(progress): MT-05's external checks on a deployed 0.16.0 (#206)") |
| `git status` | clean |
| `pnpm check` | on `41d0c27` in a detached worktree (`temp/mt06/baseline`, git-ignored) after a fresh `pnpm install --frozen-lockfile`: running; its result is recorded here when it ends. CI's baseline is the merge-queue run 44323326816 on `41d0c27`, green |
| Predecessors | Mostra 0.16.0 (MT-05's `operatorClients`) released, and [PROGRESS-MT-05](PROGRESS-MT-05.md) on `origin/main`; no `RECOVERY-MT-06-*.md` |
| Beside it | WP-17 (#185, accepted at M80, which takes D175 and M74 to M80, so this unit's are D177 and M81 on) |
| Local toolchain | Node 24.22.1 (`.node-version`, through fnm), pnpm 12.14.0, macOS 26.2 arm64; the checkout and its worktrees on the external disk |
