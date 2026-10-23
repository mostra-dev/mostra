# WP-W2 progress: Windows II, gateway, workers, verify and CLI

**Status:** In progress.

## Baseline

| | |
|---|---|
| Branch | `wp/w2-windows-local`, created from `origin/main` |
| Starting `HEAD` | `ecdceca` (`origin/main` at branch time, 2026-10-23: "ci: cache the e2e engines' apt downloads (#58) (#59)") |
| `git status` | clean |
| `pnpm check` | 27 min on macOS arm64. format-lint, types, hygiene, e2e, build, boundaries, api, licenses, rust, docs and commits green. Four failures, each green when run alone right after: the runtime's RT-03 park test (`lifecycle.test.ts`, the known load flake #42), the SDK's HO-04 test (a `fail` verdict under the full run's load), the conformance kit's `delivery.retry` against the Rust reference host, and `@mostra/tools`' knip gate, which met this branch's first file (the temporary probe, written while the check ran; knip now ignores it). The local summary also misattributed results: it showed `integration` green though Turbo reported two of its tasks failed, and `unit` failed for `@mostra/tools#test`, which Turbo reported successful (CI runs each job alone, so it isn't affected) |
| Predecessors | WP-W1 done ([PROGRESS-WP-W1](PROGRESS-WP-W1.md) on `origin/main`); no `RECOVERY-WP-W2-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, Rust 1.97.1 with the Windows targets for `cargo check` and clippy, macOS 26.2 arm64. Windows behavior is observed on GitHub's `windows-latest` (Windows Server 2025, x64) and `windows-11-arm` runners only. |
