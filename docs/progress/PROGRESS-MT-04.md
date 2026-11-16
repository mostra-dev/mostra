# MT-04 progress: a showcase walkthrough any agent can run

**Status:** In progress. A maintenance unit beside the packages from WP-17 on ([specification](../design/work-packages/MT-04.md), D174). It owns no requirement of its own (D152); its evidence is one row per item of its scope, each closed through the real public interface, and the checks it adds extend AX-06's row (the Skill), which stays with its owner.

## Baseline

| | |
|---|---|
| Branch | `mt/04-walkthrough`, created from `origin/main` |
| Starting `HEAD` | `988729e` (`origin/main`, 2026-11-16: "docs: WP-16's closeout, Mostra 0.15.0 and 0.15.1, WP-17 next (#177)") |
| `git status` | clean |
| `pnpm check` | running on `988729e` in this checkout (`/Volumes/Active/mostra-ux-01/mostra`, the external disk, `TMPDIR` on it too; the internal disk had 2.9 GiB free) |
| Predecessors | WP-16 done ([PROGRESS-WP-16](PROGRESS-WP-16.md) on `origin/main`), released as Mostra 0.15.0 and 0.15.1; no `RECOVERY-MT-04-*.md` |
| Released CLI | `@mostra/cli` and `create-mostra` 0.15.1 on npm (`latest`), the immutable GitHub release `v0.15.1`, the plugin repository's `v0.15.1` (checked 2026-11-16) |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |
