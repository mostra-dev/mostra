# WP-16 progress: extension contracts and plugin system

**Status:** In progress. Owns EX-01, EX-02, EX-03 and EX-04 ([specification](../design/work-packages/WP-16.md)).

## Baseline

| | |
|---|---|
| Branch | `wp/16-extensions`, created from `origin/main` |
| Starting `HEAD` | `72ff5e3` (`origin/main`, 2026-11-14: "UX-01: every surface a person meets, from sign-in to answer (#150)") |
| `git status` | clean |
| `pnpm check` | on `72ff5e3` in a detached worktree on the external disk (`/Volumes/Active/mostra-wp16/baseline`), after a fresh `pnpm install --frozen-lockfile`, 49 min 19 s: every job passed (format-lint, types, hygiene, e2e, build, boundaries, api, licenses, rust, conformance, docs, commits) but `unit` and `integration`, which failed cases on their time limits under the run's own load: `@mostra/react` `seams.test.ts` (D19 seam 4), `@mostra/runtime` `gc.test.ts` (VR-06, two cases) and `interaction.test.ts` (the IN-01 property), `@mostra/tools` `gates.test.ts` (the Rust and boundaries seeds), `@mostra/runtime` `operator.test.ts` (a share refused while the operator hangs: 19,980 ms against its 15 s bound) and `@mostra/cli` `contract.test.ts` (J1). Each file then passed alone at once (3, 46 and 29 unit tests; 19 integration; J1). The class MT-02, WP-30, MT-03 and UX-01 recorded; the baseline is green |
| Predecessors | WP-31 done ([PROGRESS-WP-31](PROGRESS-WP-31.md)) on `origin/main`, MT-03 and UX-01 merged after it; no `RECOVERY-WP-16-*.md`; the `WP-16` milestone holds no issue |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |

## Decisions with Mirza

- **2026-11-14T12:37Z**, his answers to the session's first questions: one model review per package from here on, Claude Opus and/or Fable as the package needs (Opus by default; Fable for architecture a test can't prove; both for very large, foundational packages), recorded as D172; the six new npm packages' one-time setup is his, at acceptance; license classes, what an install discloses, and the host's pre-acceptance delegated; home-wide installs built now; GitHub item addresses built now; contract shapes built to be extended by later packages without a rewrite; EX-01's "ARCHITECTURE §17" corrected to §13.
