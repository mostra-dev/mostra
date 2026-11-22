# MT-07 progress: a plugin the Claude directory can list

**Status:** in progress. A maintenance unit after WP-18, beside WP-19 and WP-20 ([specification](../design/work-packages/MT-07.md)); it owns no requirement of its own (D152), and the checks it adds extend AX-10's row (harness plugins from one source).

## Baseline

| | |
|---|---|
| Branch | `mt/07-claude-directory`, created from `origin/main` at `e346700c` (2026-11-22: "WP-18: Kit I, design system, tokens and forms (#215)"), with the unit's specification branch `docs/mt-07-spec` (#230, not yet on `main`) merged in as `74ceb246`, so the branch carries the specification it implements and merges cleanly whichever of #230 and this unit's pull request lands first |
| `git status` | clean |
| Static jobs | `pnpm check --job format-lint --job types --job build --job boundaries --job api --job docs --job licenses` on `74ceb246`, 2026-11-22: all seven green (format-lint 424 s, types, build and api 177 s, boundaries 102 s, docs 19 s, licenses 11 s) |
| The plugin's own checks | `node tools/plugins/cli.ts check`: "plugin mostra 0.18.0: every harness's manifest and rule hold (localMcp on, remoteMcp on)"; `vitest run test/plugins.test.ts` (tools): 7 of 7 |
| Full baseline | CI's run on this pull request's first commit (a local full `pnpm check` is load-bound on this Mac, as in WP-14 to WP-18) |
| Predecessors | WP-18 done ([PROGRESS-WP-18](PROGRESS-WP-18.md) on `origin/main`); no `RECOVERY-MT-07-*.md` |
| Beside it | The 0.19.0 version pull request (#236) and WP-18's release and closeout, in another checkout |
| Local toolchain | Node 24.22.1 (`.node-version`, through fnm), pnpm 12.14.0, macOS 26.2 arm64; Claude Code 2.1.330, codex-cli 0.162.1; the checkout on the external disk |
