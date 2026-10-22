# WP-W1 progress: Windows I, platform layer, supervisor and ledger

**Status:** In progress.

## Baseline

| | |
|---|---|
| Branch | `wp/w1-windows-platform`, created from `origin/main` |
| Starting `HEAD` | `ca21ff9` (`origin/main` at branch time, 2026-10-22: "docs(design): D146, Windows in v1.0 as WP-W1 to WP-W3 (#51)") |
| `git status` | clean |
| `pnpm check` | 13 of 14 jobs green on macOS arm64 in 28 min; `unit` failed on one test, `@mostra/server`'s "abortSignal (AC-04) › is the current call's signal, and stops fetch and timers", which timed out at 5 s under the full run's load and passes alone (16 of 16, 0.6 s). The run overlapped the start of this package's first commit (the new `crates/mostra-win`, which builds and passes clippy on every target). |
| Predecessors | WP-12 done ([PROGRESS-WP-12](PROGRESS-WP-12.md) on `origin/main`); no `RECOVERY-WP-W1-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, Rust 1.97.1 with the `x86_64-pc-windows-msvc` and `aarch64-pc-windows-msvc` targets for `cargo check` and clippy, macOS 26.2 arm64. Windows behavior is observed on GitHub's `windows-latest` (Windows Server 2025, x64) and `windows-11-arm` runners only. |
