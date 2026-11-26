# WP-19 progress: Kit II, data, diagrams, code, math, maps and 3D

**Status:** in progress. Owns KT-01, AC-08 and KT-11 ([specification](../design/work-packages/WP-19.md)), with #148, #219 and #242 on its milestone.

## Baseline

| | |
|---|---|
| Branch | `wp/19-kit-ii`, created from `origin/main` |
| Starting `HEAD` | `022d1bb3` (`origin/main`, 2026-11-26: "docs(design): D184, motion, decks and the evaluation suite after the first release (#252)") |
| `git status` | clean |
| Static jobs | `pnpm check --job format-lint --job types --job build --job boundaries --job api --job docs --job licenses` on `022d1bb3`, 2026-11-26: all seven green (format-lint 160 s, types, build and api 121 s, boundaries 86 s, docs 21 s, licenses 14 s) |
| Full baseline | CI's `ci:full` run on this pull request's first commit (a full local `pnpm check` is load-bound on this Mac, as in WP-14 to WP-20) |
| Predecessors | WP-18 ([PROGRESS-WP-18](PROGRESS-WP-18.md)) on `origin/main`; no `RECOVERY-WP-19-*.md`; the `WP-19` milestone holds #148, #219 and #242 (#148 isn't named in the specification; it is on the milestone, so it is this package's, M41) |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |

## Decisions with Mirza

- **2026-11-26 (M105):** every recommendation of the session's first question set accepted ("I trust you to make the most robust … decisions"): `@xyflow/react` 13; a map's default basemap is a world outline the kit carries, in the page's theme, with any style URL as an option; one kit module per library; a kit module's on-demand libraries installed at the kit's own pins; the code editor and the whiteboard save as fields; AC-08's target set from a measured baseline (this Mac is slow, so its numbers are read as a floor, not as CI's); the Skill's text accepted at the end as one batch; one Claude Opus review.
