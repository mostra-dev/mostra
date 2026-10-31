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
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64; Claude Code 2.1.314 and codex-cli 0.162.1 installed; Gemini CLI, Cursor's agent CLI and Copilot CLI not installed yet (installed later in scratch, below) |


## Decisions

- **M49** (2026-10-30): Mirza delegated every WP-14 choice with `<ITU/>` after the session's seven questions, and asked to check Muse, Grok Bot and OpenAI's dots, to prepare what later packages enable so they know to turn it on and doing so is close to a flag, and gave published design and skill-writing skills as references.
- **D162**: WP-14's choices under M49: one Skill with eight references, a baseline stylesheet and three verified examples, served by the CLI as `mostra docs guide`; its pinned CLI kept at the release's version; the Skill checked as a mechanism (frontmatter, links, every command it shows, every author export documented, every code sample verified); `mostra new` scaffolding `AGENTS.md` and `CLAUDE.md`; one generated plugin repository, `mostra-dev/mostra-plugin`, for every harness; MCP servers as flags WP-15 and WP-30 turn on; the release publishing the plugin with a deploy key; where each harness and directory stands; and the live-loading fix found while building.

## Evidence

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| AX-06 | validated | The Skill meets the Agent Skills specification (skills-ref) and the CLI's checks: frontmatter, every link and anchor, every `mostra …` it shows parses with its flags, every export of `@mostra/react` (subpaths included) and `@mostra/server` and every command documented or listed as internal; every code sample of the references and the three examples pass real verify; `mostra new` writes `AGENTS.md` (the loop, the CLI pinned to the release, every command parsing) and a `CLAUDE.md` importing it, completed after a crash and never over the author's edit; the guide reads through `mostra docs guide`; Claude Code, Codex, Gemini CLI, Copilot CLI and the `skills` CLI load the Skill. Mirza's acceptance of the prose (D149) is pending | `uvx --from skills-ref==0.1.1 agentskills validate skills/mostra`; `vitest run test/unit/skill.test.ts` (CLI); `vitest run test/integration/verify.test.ts -t "Skill"` and `-t "code sample"` (runtime); `test/integration/publish.test.ts`, `publish-faults.test.ts`, the CLI's `contract.test.ts`; `prove-seeds.ts --only AX-06`; `tools/plugins/try-harnesses.sh` | skills-ref: valid; CLI Skill suite 6/6, each check red on its seed (frontmatter, a broken link and anchor, a bad flag, an undocumented export and command, a changed stylesheet) and green restored; samples, decision, inbox and dashboard pass verify with no error or warning; four AX-06 seeds red planted, green restored (no `AGENTS.md`, an overwritten author file, a sample calling the API wrongly, review-4's replay); every harness that ran found the Skill |
| AX-10 | verified | `tools/plugins/` builds the plugin repository from one definition with real copies (no links), and `check` holds it to the vendored Agent Plugins 1.0 JSON Schemas and every directory rule (Anthropic's file, launcher, credential and disclosure rules; OpenAI's no plans, upgrades or trials; no hooks; MCP flags consistent, with WP-15's tripwire) in CI's `docs` job. External: the plugin installed and its Skill was found through each harness's own CLI in scratch homes: Claude Code (`plugin validate --strict` passed), Codex, Gemini CLI, GitHub Copilot CLI, and the `skills` CLI; Cursor's CLI needs a signed-in account | `node tools/plugins/cli.ts check`; `vitest run test/plugins.test.ts` (tools); `tools/plugins/try-harnesses.sh /Volumes/Active/mostra-wp14-tools/run1` with Claude Code 2.1.314, codex-cli 0.162.1, Gemini CLI 0.66.0, Copilot CLI 1.0.105, skills 1.7.4, skills-ref 0.1.1 | check green at 0.7.0 (both features off); plugin suite 7/7, each rule red on its seed (link, hook, version, schema, Skill copy, disclosure, commercial word, unpinned launch, system file, binary, package source, environment credential, icon, remote URL and privacy policy, the WP-15 tripwire); every installed harness ✓ (external, 2026-10-30) |
