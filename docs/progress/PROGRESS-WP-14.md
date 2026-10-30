# WP-14 progress: the Agent Skill, AGENTS.md and harness plugins

**Status:** In progress. Owns AX-06 and AX-10 ([specification](../design/work-packages/WP-14.md)).

## Baseline

| | |
|---|---|
| Branch | `wp/14-skill`, created from `origin/main` |
| Starting `HEAD` | `0de3841` (`origin/main`, 2026-10-30: "docs: WP-13's closeout, Mostra 0.7.0, WP-14 next (#107)") |
| `git status` | clean |
| `pnpm check` | running on the starting commit (macOS arm64); the result is recorded here when it ends |
| Predecessors | WP-13 done ([PROGRESS-WP-13](PROGRESS-WP-13.md) on `origin/main`), released as Mostra 0.7.0; no `RECOVERY-WP-14-*.md` |
| Milestone `WP-14` | empty; #39, #46, #55, #85, #95 and #106 stay on no milestone (D155 item 7) |
| Open pull requests | #102 (D159 to D161, the remote design's defaults) and #101 (`SECURITY.md`), neither touching this package's files; this package's decision takes the next free number after them |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64; Claude Code 2.1.314 and codex-cli 0.162.1 installed; Gemini CLI, Cursor's agent CLI and Copilot CLI not installed yet |
