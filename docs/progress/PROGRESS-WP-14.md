# WP-14 progress: the Agent Skill, AGENTS.md and harness plugins

**Status:** In progress. Owns AX-06 and AX-10 ([specification](../design/work-packages/WP-14.md)).

## Baseline

| | |
|---|---|
| Branch | `wp/14-skill`, created from `origin/main` |
| Starting `HEAD` | `0de3841` (`origin/main`, 2026-10-30: "docs: WP-13's closeout, Mostra 0.7.0, WP-14 next (#107)") |
| `git status` | clean |
| `pnpm check` | 62 min on `0de3841` (macOS arm64, with `TMPDIR` on the external `Active` disk; the system disk had 8.6 GiB free). Green: format-lint, types, integration, hygiene, build, boundaries, api, licenses, rust, conformance, docs, commits. Failed by timeouts under the full run's load, in tests that pass on CI, as in WP-13's and MT-02b's baselines: unit (`@mostra/react` `seams.test.ts` at 60 s, `@mostra/runtime` `interaction.test.ts`'s property test and `gc.test.ts` VR-06, `@mostra/worker` `index.test.ts` at 30 s) and e2e (27 Firefox tests, one WebKit `actions.spec.ts`; 161 passed). `0de3841`'s own merge-queue run (#107) passed every job, which is the real baseline |
| Predecessors | WP-13 done ([PROGRESS-WP-13](PROGRESS-WP-13.md) on `origin/main`), released as Mostra 0.7.0; no `RECOVERY-WP-14-*.md` |
| Milestone `WP-14` | empty; #39, #46, #55, #85, #95 and #106 stay on no milestone (D155 item 7) |
| Open pull requests | #102 (D159 to D161, the remote design's defaults) and #101 (`SECURITY.md`), neither touching this package's files; this package's decision takes the next free number after them |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64; Claude Code 2.1.314 and codex-cli 0.162.1 installed; Gemini CLI, Cursor's agent CLI and Copilot CLI not installed yet |
