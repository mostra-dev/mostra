# MT-03 progress: the operator ports as specified, and what sign-in and metering lack

**Status:** In progress. A maintenance unit after WP-31 ([specification](../design/work-packages/MT-03.md)); it owns no requirement of its own, and the checks it adds extend HO-09's and HY-08's rows. Its scope is eight items: `limits` for relayed runs, waiting runs and calls; a link's idle expiry on a fresh visit; GitHub's public counts and chosen OpenID Connect claims in `facts`; the verifier recorded per identity and verified providers an operator module supplies; a home's held bytes in metering; the version being pushed in `limits`' query; and a design for homes an organization owns, brought to Mirza.

## Baseline

| | |
|---|---|
| Branch | `mt/03-operator-ports`, created from `origin/main` |
| Starting `HEAD` | `764cbc8` (`origin/main`, 2026-11-12: "docs: WP-31's closeout, Mostra 0.12.0, WP-16 next (#143)") |
| `git status` | clean |
| `pnpm check` | running on `764cbc8` in a detached worktree (`temp/mt03/baseline`, git-ignored), after a fresh `pnpm install --frozen-lockfile`; recorded here when it ends |
| Predecessors | WP-31 done ([PROGRESS-WP-31](PROGRESS-WP-31.md) on `origin/main`); no `RECOVERY-MT-03-*.md` |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |
| Disk | 17 GiB free on the internal disk at the start |

## Decisions

## Slices

| Commit | Slice |
|---|---|

## Evidence

| Item | State | Check | Command | Result |
|---|---|---|---|---|
