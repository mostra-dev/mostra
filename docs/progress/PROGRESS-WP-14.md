# WP-14 progress: the Agent Skill, AGENTS.md and harness plugins

**Status:** Accepted by Mirza on 2026-10-31 (M50: "absolutely incredible work. I approve, 100%.") with D162 and its agent-facing prose; closing out. Owns AX-06 and AX-10 ([specification](../design/work-packages/WP-14.md)).

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
| AX-06 | verified | The Skill meets the Agent Skills specification (skills-ref) and the CLI's checks: frontmatter, every link and anchor, every `mostra …` it shows parses with its flags, every export of `@mostra/react` (subpaths included) and `@mostra/server` and every command documented or listed as internal; every code sample of the references and the three examples pass real verify; `mostra new` writes `AGENTS.md` (the loop, the CLI pinned to the release, every command parsing) and a `CLAUDE.md` importing it, completed after a crash and never over the author's edit; the guide reads through `mostra docs guide`; Claude Code, Codex, Gemini CLI, Copilot CLI and the `skills` CLI load the Skill. Mirza's acceptance of the prose (D149) is pending | `uvx --from skills-ref==0.1.1 agentskills validate skills/mostra`; `vitest run test/unit/skill.test.ts` (CLI); `vitest run test/integration/verify.test.ts -t "Skill"` and `-t "code sample"` (runtime); `test/integration/publish.test.ts`, `publish-faults.test.ts`, the CLI's `contract.test.ts`; `prove-seeds.ts --only AX-06`; `tools/plugins/try-harnesses.sh` | skills-ref: valid; CLI Skill suite 6/6, each check red on its seed (frontmatter, a broken link and anchor, a bad flag, an undocumented export and command, a changed stylesheet) and green restored; samples, decision, inbox and dashboard pass verify with no error or warning; seven AX-06 seeds red planted, green restored (no `AGENTS.md`, an overwritten author file, a sample calling the API wrongly, review-4's replay, a retry that rewrites the files as the retrying runtime would, a cut inside a character, a release's words); every harness that ran found the Skill; Mirza accepted the prose at M50 (D149) |
| AX-10 | verified | `tools/plugins/` builds the plugin repository from one definition with real copies (no links), and `check` holds it to the vendored Agent Plugins 1.0 JSON Schemas and every directory rule (Anthropic's file, launcher, credential and disclosure rules; OpenAI's no plans, upgrades or trials; no hooks; MCP flags consistent, with WP-15's tripwire) in CI's `docs` job. External: the plugin installed and its Skill was found through each harness's own CLI in scratch homes: Claude Code (`plugin validate --strict` passed), Codex, Gemini CLI, GitHub Copilot CLI, and the `skills` CLI; Cursor's CLI needs a signed-in account | `node tools/plugins/cli.ts check`; `vitest run test/plugins.test.ts` (tools); `tools/plugins/try-harnesses.sh /Volumes/Active/mostra-wp14-tools/run1` with Claude Code 2.1.314, codex-cli 0.162.1, Gemini CLI 0.66.0, Copilot CLI 1.0.105, skills 1.7.4, skills-ref 0.1.1 | check green at 0.7.0 (both features off); plugin suite 7/7, each rule red on its seed (link, hook, version, schema, Skill copy, disclosure, commercial word, unpinned launch, system file, binary, package source, environment credential, icon, remote URL and privacy policy, the WP-15 tripwire); every installed harness ✓ (external, 2026-10-30) |

## Issues

| Issue | State | What was found and done |
|---|---|---|
| #95 | Open, no milestone (D155 item 7) | A new occurrence on #108's first CI run (41140136633, Windows x64 `windows-gateway`): `gateway.test.ts`'s "serves a client-only version with no process" timed out while the gateway logged nothing for the whole minute after the frame session; recorded on the issue. None of WP-14's changes touch the gateway or that test |
| CodeQL `js/file-system-race` | Fixed (`5f0e946`) | The Skill's link check stat-ed a target, then read it; it now reads once and tells a missing file from a directory by the error. A seeded broken link and anchor went red, then green |
| (no issue) | Fixed (`0cd2382`) | `@mostra/react`'s browser test "lists blockers by label" read the blockers right after the first commit, before the fields' registration effects re-rendered; under the pre-push check's load it read the commit between. It now waits for the same value |

## Reviews (D80)

- **My review of the diff**, during the work and before the reviews: found the plugin job writing the deploy key with no check that the secret is set and leaving it on the runner (fixed in `2fa053f`: it fails closed with the playbook's pointer and removes the key on exit), the reference samples that weren't complete modules (each now compiles and passes verify, `dc033b0`), and a skill-ref example reading a credential from the environment, which Anthropic's scan holds (`7e48ff6`).
- **GPT-6.1-Sol** through `codex review --base origin/main` (OpenAI, ChatGPT sign-in, codex-cli 0.162.1), effort high, on 2026-10-31 against `0cd2382`: 3,306,872 input tokens (3,154,560 cached) and 11,528 output (6,571 reasoning). A GPT-only run, announced in the session (D34). Three findings, all P2, all valid, each fixed with a check red on the old code:
  1. A plugin publication that failed after npm finished was never retried: the next run's plan saw the version released in full and skipped the plugin job. The plan now reports `plugin=` on its own, true while the plugin's repository lacks the version's tag, and the job runs after a successful publish or on its own; a release older than the generator publishes nothing (`81c4dcc`; `state` run on `origin/main`'s tree said `plugin=true`, on this branch `plugin=false` with changesets pending).
  2. The CLI's Skill test read the author API reports and React's form and router entries, which its Turbo inputs and the affected plan didn't name, so a new export could reuse a cached pass. Both name them now (`49e001c`; the rules test red on the old plan, green on the fix).
  3. A creation cut short and retried by a newer runtime made `AGENTS.md` for the newer release, so the cut-short file was left as the author's. The record keeps the release beside the result, and a retry completes that release's text; a record from before is the result alone (`e2f75ee`; two integration tests, and a seed red, then green).
- **Claude Opus 5.5** (D144), run by Mirza on 2026-10-31 from the prompt written for it, against `90b63f5`, posted on #108 (Anthropic, run and approved by Mirza, D34). Ten findings (5 P2, 5 P3), all valid, each fixed with a check red on the old code:
  1. (P2) A live key nothing produces (one only `mostra push` writes) stayed loading forever, and verify waited out its server limit on every render and after every click: 29 s and 32 s for a page with four buttons, against 7 to 11 s and 3 s after. The gateway says when a first load is on its way (`LiveState.awaiting`, additive to `2026-10-15`), and an update says when a source read that way only streams (`5d5b5f7`; unit and integration tests, two AC-07 seeds). Building the test found that a pushed key doesn't type-check beside a `live.ts`; the long-lived reference now shows the declaration that types it, which the samples test checks.
  2. (P2) Publishing an older version's plugin (a retried release after a newer one) committed it on top of `main`, rolling every default-branch install back. An older version is tagged on a commit off `main` now, and a tree built for another version is refused (`2982660`; red when `main` may move back).
  3. (P2) The plugin was built without the release's telemetry endpoint, so its README could say "no usage data" of a CLI that sends some. The plan reads `MOSTRA_RELEASE_TELEMETRY_ENDPOINT` once (a repository variable, empty until the managed collector exists, D142 item 11); the bundles, the npm packages and the plugin take that value, and the CLI's Turbo build now receives and hashes it, which it never did (`baf0f42`; a workflow test red on a dropped endpoint).
  4. (P2) The deploy key was used in a job that had just installed dependencies with their lifecycle scripts. `plugin-build` installs, builds and checks with no secret and uploads the tree with its digest; `plugin` holds the key, installs nothing, checks the digest and runs `publish.ts`, which repo lint holds to Node.js built-ins, following its local imports (`baf0f42`; a workflow test red on an install in the key's job).
  5. (P2) The check looked for hooks in four manifests only, scanned no Skill or marketplace for upgrade prompts, and gave only Agent Plugins' manifests a schema. Every JSON file outside the Skill is searched for hooks, every text file for plans, upgrades and trials (as phrases), and the other five manifests are held to closed shapes written from their references (`tools/plugins/manifests.ts`, `33cf7be`; five seeds red on the old check).
  6. (P3) A retry by a runtime whose `AGENTS.md` words differ, or a write cut inside a multibyte character, left a truncated file for good. The record keeps each file's exact text and a retry compares bytes (`2fa6e10`; a test with an older release's words and a cut inside "ü", two seeds).
  7. (P3) A version whose source predates the generator (0.7.0) kept the plugin due, so every push to `main` started the `release` environment for nothing. The plan asks only when the tag's source has the generator (`baf0f42`; run on `origin/main`: "plugin: none in this version's source").
  8. (P3) The launch rule grepped for `@mostra/cli`. Each server's command and arguments are read: a package launcher must name an exact version, any other command must be the plugin's own, remotes HTTPS (`33cf7be`; seven launches, red and green as each should be).
  9. (P3) A bare `npx` can't start on native Windows in a harness that spawns without a shell. `features.localMcp.verifiedOn` must list macOS, Linux and Windows before the check lets the feature on, and the playbook's step 3 and WP-15's handoff say how to prove or adapt the launch there (`33cf7be`).
  10. (P3) The version pattern, the tree walk and the argv helper were copied across the tools; they are `tools/lib/release-version.ts` (no imports, so the key's job may run it) and `tools/lib/files.ts` now, and the workflow's version guard is tested to accept exactly what the tools accept (`2982660`, `baf0f42`).

  A last fix the pre-push unit suite asked for (`e061bea`): a source counts as loading unless its worker says `load: false`. `ci:full` on `e061bea` (run 41210726067): 69 jobs, every leg green.

  After the fixes the plugin loads again in Claude Code 2.1.316 (`validate --strict`), Codex, Gemini CLI, Copilot CLI, the `skills` CLI and `skills-ref` (`tools/plugins/try-harnesses.sh`, every line green).
- **Copilot**: no review (its quota, as on WP-13).

## Agent-facing prose (D149)

For Mirza's acceptance in one batch: `skills/mostra/SKILL.md` and its eight references (`page`, `answers`, `design`, `verify`, `server`, `long-lived`, `sharing`, `libraries`); the scaffolded `AGENTS.md` (`packages/runtime/src/publish/scaffold.ts`); the plugin's README (`tools/plugins/readme.ts`, built into the plugin); the root `AGENTS.md`'s new section and the AGENTS.md lines of the CLI and the runtime; `docs/agents/check-harness-plugins.md` and the release playbook's plugin steps; the `docs` command's summary.

## Untested boundaries

- **The release's `plugin` job has never run for real.** The repository, its rulesets, the deploy key and the `release` environment's secret exist and `tools/github/settings.ts verify` checks them; `publish.ts` is proven against a local bare repository (first publish, identical retry, a divergent tag refused, the next version). The first real push is the next release's (0.8.0), checked from outside in its closeout.
- **Cursor and Muse Code** didn't load the plugin here: Cursor's agent CLI manages marketplaces only signed in, and Muse Code's plugins are a developer preview not installed on this Mac. Both read the Agent Plugins manifest the check validates against its schema.
- **Directory review itself**: no directory has scanned the plugin yet. The check encodes Anthropic's published rules as of 2026-10-30; a pinned `npx` server (WP-15) is held for a reviewer by rule.
- **Meta's Muse app** is known only from secondary sources (Meta's pages answered 401).
- **Local browser suites under load**: this Mac's full `pnpm check` (load averages 14 to 28 from other work) failed 48 e2e tests in Firefox and WebKit by timeouts, against 28 in the baseline; WebKit's actions and client specs alone failed one test per run, a different one each time, both seen in the baseline. Every e2e leg of #108's CI passed (Linux in three engines, macOS WebKit, Windows Chromium and Firefox).

- **The local MCP server's launch** is off until WP-15 and was never started from a harness; on native Windows it must be proven or adapted before `verifiedOn` lets it on (the Opus review's finding 9).

## Deviations

- **A fix outside the scope list:** `@mostra/react`'s live sources stay loading until their first value (D162 item 8), found when the dashboard example's screenshot showed a page still loading.
- **More than the five harnesses:** the plugin also serves the ChatGPT desktop app, VS Code, Muse Code and Grok Build through the formats they read (D162 item 4), as Mirza asked at M49.
