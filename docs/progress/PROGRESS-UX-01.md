# UX-01 progress: every surface a person meets, from sign-in to answer

**Status:** In progress. A design unit (it owns no requirement) over every page the open server draws outside an artifact: the API origin's pages, the hosted shell's trusted chrome and the pages a link can end on ([specification](../design/work-packages/UX-01.md)). The same session builds the operating layer's own surfaces outside this repository on this package's published themes; nothing of that half enters this report.

## Baseline

| | |
|---|---|
| Branch | `ux/01-surfaces`, created from `origin/main` |
| Starting `HEAD` | `f646253` (`origin/main`, 2026-11-13: "docs: MT-03's closeout, Mostra 0.13.0, WP-16 next (#149)") |
| `git status` | clean |
| `pnpm check` | on `f646253` in a detached worktree on the external disk (`/Volumes/Active/mostra-ux-01/.baseline/mostra`), after a fresh `pnpm install --frozen-lockfile`, 66 min 51 s while another repository's integration suites ran beside it: every job passed (format-lint, types, hygiene, e2e, build, boundaries, api, licenses, rust, conformance, docs, commits) but `unit` and `integration`. `unit` failed cases on their time limits under the load (`@mostra/protocol` `ids.test.ts` and `serializer.test.ts`, `@mostra/mcp` `server.test.ts`, `@mostra/react` `seams.test.ts`, `@mostra/runtime` `gc.test.ts` and `interaction.test.ts`'s properties, `@mostra/worker` `index.test.ts`, `create-mostra` `run.test.ts`, `@mostra/tools` `gates.test.ts`), and `integration` one case of `operator.test.ts` (a share refused while the operator hangs). Every one of those files then passed alone at once (92, 15, 3, 46, 9, 4, 29 and 19 tests). The class MT-02, WP-30 and MT-03 recorded; the baseline is green |
| Predecessors | WP-31 done ([PROGRESS-WP-31](PROGRESS-WP-31.md)) and MT-03 done ([PROGRESS-MT-03](PROGRESS-MT-03.md)), both on `origin/main`; no `RECOVERY-UX-01-*.md` |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |

## Decisions with Mirza

- **2026-11-13T11:51Z**, his answers to the session's first questions: a themes package rather than a one-purpose stylesheet, built to last ("robust, high-quality, modular, future-proof"), which everything that uses the themes adopts; dark mode following the system with a switch for a person's own choice; the operating layer's dashboard built now on the Skill's Studio stylesheet and Base UI parts, its later move to the kit noted for WP-18; the open runtime's requests that are close to this package taken in it; dates are his, not this package's. Brand or Studio, and the open server's name under a self-hoster, were shown to him as screenshots for his choice.

## Slices

| Commit | Slice |
|---|---|
| (this) | UX-01 in WORK_PACKAGES.md (a design unit, owning no requirement, like a maintenance unit); `wp_specs.py` and `evidence_matrix.py` accept `UX-NN`; the generated specification; this report's baseline |
