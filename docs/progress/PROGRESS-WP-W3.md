# WP-W3 progress: Windows III, distribution, SDK, host crate and conformance

**Status:** In progress. The report grows during the session and is finalized after acceptance
(work-packages/README.md §4).

## Baseline

| | |
|---|---|
| Branch | `wp/w3-windows-distribution`, created from `origin/main` |
| Starting `HEAD` | `9675dab` (`origin/main`, 2026-10-25: "docs(progress): MT-01's closeout, Mostra 0.5.0 (#78)") |
| `git status` | clean |
| `pnpm check` | 29 min 45 s on macOS arm64. Green: format-lint, types, unit, integration, hygiene, e2e, build, boundaries, api, licenses, rust, docs and commits. One failure: `conformance`, the Rust reference host's broken mode, whose `delivery.retry` saw no `submission.retrying` event while the delivery waited, under the full run's load (as in WP-W2's baseline). `pnpm check --job conformance` alone right after: green in 191 s |
| Predecessors | WP-W2 done ([PROGRESS-WP-W2](PROGRESS-WP-W2.md) on `origin/main`), and MT-01 after it ([PROGRESS-MT-01](PROGRESS-MT-01.md)); no `RECOVERY-WP-W3-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, Rust 1.97.1, macOS 26.2 arm64. Windows behavior is observed only on GitHub's `windows-latest` (Windows Server 2025, x64) and `windows-11-arm` runners |
