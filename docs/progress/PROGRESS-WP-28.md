# WP-28 progress: the remote design pass

**Status:** In progress. Owns RM-05 ([specification](../design/work-packages/WP-28.md)). This package writes design, not code.

## Baseline

| | |
|---|---|
| Branch | `wp/28-remote-design`, created from `origin/main` |
| Starting `HEAD` | `821322e` (`origin/main`, 2026-11-05: "docs: WP-15's closeout, Mostra 0.9.0, WP-28 next (#125)") |
| `git status` | clean |
| `pnpm check` | green on `821322e` in a detached worktree on the external `Active` disk (macOS 26.2 arm64, Node 24.22.1, pnpm 12.14.0). The first full run (2,331 s) failed only `unit`, in three packages, from causes outside the code: the system disk filled during the run, so `@mostra/sdk`'s bundle tests met their own free-space check (`MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED`, "0.4 GiB is free"), and two runtime property tests and one React seam test passed their 30 s and 60 s limits on the loaded machine. Once space was freed, `pnpm check --job unit` re-ran the three packages (Turbo cache misses) and passed. Every other job passed in the first run |
| Predecessors | WP-15 done ([PROGRESS-WP-15](PROGRESS-WP-15.md) on `origin/main`), released as Mostra 0.9.0; no `RECOVERY-WP-28-*.md` |
| Milestone `WP-28` | empty; #39, #46, #55, #85, #95, #111 and #124 stay on no milestone (D155 item 7), and #106 waits for the package that takes it |

## Decisions

- **Question set** (2026-11-05T00:39Z): the fourteen questions of the specification, the infrastructure questions and the CLI names, each with options and a recommendation, given to Mirza in one set.
- **M56** (2026-11-05T02:08:17.505Z): "Go with your recommendations, with the changes and additions below." Recorded as **D165**, one entry naming what it amends: D81 for hosted homes (item 0b), IN-13 for hosted links (item 1a), D117's offline states (item 4).
- **Written into the dossier:** ARCHITECTURE §15 (new; the seed's resolution table moves to §16), INTERFACES §18 (new) with pointers from §1, §2.2, §2.3, §4, §6, §7, §9, §12 and §13, DATA_MODEL §3, §4 and §7, FAILURE_MODEL §11, PRODUCT's vocabulary and J10, REPO_STANDARDS §3 (the runtime modules `link` and `server`; `server` may import `@mostra/mcp`), REQUIREMENTS (IN-13 and RM-04 amended; RM-07 to RM-09 added), WORK_PACKAGES' WP-29 and WP-30, and `tools/design/wp_specs.py`'s WP-29, WP-30 and WP-31 detail, regenerated.

## Evidence

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| RM-05 | unverified | Mirza accepts the design; the generators pass with the refined WP-29 and WP-30 specifications | `python3 tools/design/wp_specs.py`, `python3 tools/design/evidence_matrix.py --check` | pending |
