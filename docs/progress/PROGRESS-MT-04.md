# MT-04 progress: a showcase walkthrough any agent can run

**Status:** Accepted by Mirza on 2026-11-16 ("Prose: Looks good!"; the independent review "Not needed since this is a prose-heavy WP"). A maintenance unit beside the packages from WP-17 on ([specification](../design/work-packages/MT-04.md), D174). It owns no requirement of its own (D152); its evidence is one row per item of its scope, each closed through the real public interface, and the checks it adds extend AX-06's row (the Skill), which stays with WP-14.

## Baseline

| | |
|---|---|
| Branch | `mt/04-walkthrough`, created from `origin/main` |
| Starting `HEAD` | `988729e` (`origin/main`, 2026-11-16: "docs: WP-16's closeout, Mostra 0.15.0 and 0.15.1, WP-17 next (#177)") |
| `git status` | clean |
| `pnpm check` | `988729e`'s own merge-queue run (43782644211, #177, every job the plan listed) is green, which is the baseline. A local run started on `988729e` in this checkout (`/Volumes/Active/mostra-ux-01/mostra`, `TMPDIR` on the external disk) was stopped after 46 minutes and isn't counted: the internal disk filled up under it (Mirza freed it), and this unit's first edits landed in the same working tree while it ran. The candidate's full local run is under Candidate checks |
| Predecessors | WP-16 done ([PROGRESS-WP-16](PROGRESS-WP-16.md) on `origin/main`), released as Mostra 0.15.0 and 0.15.1; no `RECOVERY-MT-04-*.md` |
| Released CLI | `@mostra/cli` and `create-mostra` 0.15.1 on npm (`latest`), the immutable GitHub release `v0.15.1`, the plugin repository's `v0.15.1` (checked 2026-11-16) |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |

## Decisions

- **2026-11-16T09:14Z**: Mirza delegated every question of the unit's first set: the reference's sections, its named scenarios, the hosted server in the text, the site's copy, the real runs, the button and the checkout ("I trust you to make the most robust … decision"). At 10:49Z he chose a Claude Sonnet pilot in place of the blocked GPT one, and left #183 to a later package. At 13:28Z he accepted the unit's prose (D149), waived the independent review for a unit mostly of prose (D172 item 0), and agreed to fix #182 now, apart from this unit.
- **D174 item 7's deferred details, settled:**
  1. **Sections and order:** an opening paragraph, then "The rules" (D174 items 4 and 5, first because they bound every step), then seven numbered steps, each ending on a *Done when*: 1. Get Mostra running (the three ways in), 2. Learn what the person does, 3. Build the page, 4. Verify and look, 5. Publish and hand out the links, 6. Wait, read and keep building, 7. Let the person decide.
  2. **Scenarios by name:** five, in a table that maps each to the page's live number, its two people's answers, its choice and its button: D174's three (a team's weekly numbers, a client's report, a launch checklist), and a design between two options and a small panel's scores. The agent otherwise uses the person's own words.
  3. **The site's copy:** the Skill's reference is the source. The site publishes a short copy (the three ways in, then the same steps in short, D174 item 3), [below](#the-sites-copy), which points at the full reference through `mostra docs guide/walkthrough` and GitHub. The two can't be byte-identical by design, so this repository holds no comparison check. The copy's commands were held to the same check as the Skill's (15 commands, all parse, no unknown flag, condition or topic). The site's repository, or WP-26's docs site, can run the same helpers (`packages/cli/test/commands.ts`) over its copy at each release.
  4. **The guide index:** no entry. `mostra docs guide/<name>` serves every file in `references/` (`guideTopics` in `@mostra/mcp`), and the CLI's contract test now reads `guide/walkthrough` through the built binary.
- **The unit's own choices** (under the delegation):
  - The check holds every Skill file, not only the walkthrough, to what the release has: commands and their flags (as before), flags named on their own, wait conditions, `docs` topics, MCP tool names and hooks.
  - The page's moving number is a key only the agent pushes. A `live.ts` source with `load` loads again whenever interest returns and would overwrite a push (`packages/runtime/src/live/index.ts`, `startProducer`). The chart comes from `defineLive`.
  - The button writes a Markdown note into `notes/` beside the source (server code runs there, `sourceDirectory` in `instance/index.ts`), listed in `.mostraignore`. Version 2's exported source holds no note.
  - The person's own link opens with `mostra open <dir> --new --viewer <ref> --browser`, the same viewer as their roster entry, so their answer counts for `submitted:all`.
  - On a hosted server, `share --cloud --respondent` is followed by `roster add --name` for each person, which names them and prints the link to hand out (#184).
  - Through a chat app's tools there is no roster (#183), so the walkthrough waits once per person by cursor and reads each `submissionId`.
  - Each choice's label is two or three words while #182 stands: the shell's phone bar repeats it, and a long one hides the trusted Submit.
  - `references/server.md` says `viewer()` is `undefined` where no one called, as its API report does (found by the real run's type check).

## Slices

| Commit | Slice |
|---|---|
| `78ca076`, `5b6f049` | This report's baseline |
| `c708430` | `references/walkthrough.md`, the two `SKILL.md` rows, `server.md`'s `viewer()` line, the changeset |
| `377a478` | The check: flags, conditions, topics, tools and hooks the release has; `docs guide/walkthrough` through the built CLI; MT-04's seeds |
| `08d3c50` | Each reference has its own row in `SKILL.md`, and the task table names the walkthrough (a seed first went green) |
| `beaf748` | The real runs' lessons in the reference (the hosted links, short choice labels); this report and its evidence |
| `dbf255e` | The session's own review: the name checks' own cases, and a `docs` topic found past its flags |

## Evidence

MT-04 owns no requirement (D152). Its checks extend AX-06's row, which stays with WP-14. One row per item of its scope, each closed through the real interface: the released CLI from a clean home, real browsers, the released `mostra mcp`, the staging server, a real Cloudflare tunnel and an agent given only the person's request. Each check's seeded violations (`node packages/runtime/scripts/prove-seeds.ts --only MT-04`) go red when planted and green when restored.

| Item | State | Check | Command | Result |
|---|---|---|---|---|
| 1. The reference, `skills/mostra/references/walkthrough.md` | verified | Followed literally from a clean home (empty `HOME`, Mostra home, cache, config and npm cache on the system disk) against the released CLI, in a launch-checklist scenario with sample data: first run, `new`, a five-part page, `verify --screenshots always` (one type error fixed, both screenshots looked at, one fix, pass), `publish`, `push`, `roster add` for both people, the person's own link through `open --new --viewer --browser`, two people answering from their own links in two browsers (presence and roster status by name, the pushed number changing on both open pages, a choice through the trusted Choose, a `"use server"` note written by the button), `wait --until submitted:all` woken by `roster.completed`, `results --all` with both answers and the button's run, version 2 grown from the answers and offered by the banner with the answers carried over. Then, given only the person's request and the Skill as the plugin installs it, Claude Sonnet ran it end to end on its own (19 turns, 10 minutes): it found the walkthrough through `SKILL.md`'s rows, built and verified a five-part page in the person's scenario, looked at both screenshots, published, pushed, named both people, opened the person's link, waited in rounds, read both answers, grew version 2 and closed with an honest "should you use it". And the chat-app way's tool sequence through the released `mostra mcp`: create, write, verify, publish, a link per person with `viewer`, a wait per respondent by cursor, each `submissionId` read, `live_push` | `npx -y @mostra/cli@0.15.1` from `<run>` ([transcript](evidence/mt-04/transcript.md)); `claude -p --model sonnet` ([run](evidence/mt-04/pilot-sonnet.md)); an MCP client over stdio ([run](evidence/mt-04/mcp-check.md)) | first run 158 s; verify pass with no warning ([desktop](evidence/mt-04/verify-desktop.png), [phone](evidence/mt-04/verify-mobile.png)); both submissions, the note and version 2 as described ([the page](evidence/mt-04/ada-open.png), [version 2](evidence/mt-04/ada-version-2.png)); the pilot's page passed verify ([desktop](evidence/mt-04/pilot-verify-desktop.png), [phone](evidence/mt-04/pilot-verify-mobile.png)) and both answers came back; the MCP way as written. Three findings: #182, #183, #184 ([Issues](#issues)) |
| 2. `SKILL.md`'s two rows | verified | The task table points at the walkthrough; every reference, the walkthrough included, has its own row in the references table (a link elsewhere no longer stands in for it: the first seed went green on the old check) | `vitest --project unit test/unit/skill.test.ts` (CLI); `prove-seeds.ts --only MT-04 --name "SKILL.md's"` | pass; 2 seeds red, then green |
| 3. `mostra docs guide/walkthrough` | validated | The built CLI prints the walkthrough as `guide/walkthrough`, with its URL and the note on how its links read; the index lists it. Served from the references folder (D174 item 7) | `vitest --project integration test/integration/contract.test.ts -t "docs"` (CLI); `prove-seeds.ts --only MT-04 --name "guide/walkthrough"` | pass; 1 seed red (the reference left out of the guide), then green. The released CLI serves it from the next release ([Untested boundaries](#untested-boundaries)) |
| 4. The command check | verified | Every Skill file names only what the release has: commands that parse with their flags; flags written on their own, with values their choices allow; wait conditions `mostra wait` takes (the protocol's `WaitCondition`); `mostra docs` topics the bundled reference has; MCP tools the server serves (`createTools`); hooks `@mostra/react` exports (others listed with whose they are, and a stale entry refused) | `vitest --project unit test/unit/skill.test.ts` (CLI); `prove-seeds.ts --only MT-04` | 7 tests pass; 7 walkthrough seeds red, then green (a command, a flag value, a flag, a condition, a tool, a hook, a topic); a choice value in `verify.md` red by hand too |
| 5. The site's copy | validated | A [site-ready copy](#the-sites-copy), held to the command check's helpers | `node --conditions=@mostra/source temp/mt04/check-site.ts` | 15 commands, all parse; no flag, condition or topic problem |
| 6. The hosted path | verified (external) | Against the staging server (`https://api.mostradev.com`, server 0.14.0) from the clean home: `login` by the device grant (Mirza approved with GitHub), `share --cloud --respondent` for two people, `roster add --name` for each, two people answering their hosted links in two browsers (sender line, "Never enter passwords", roster names, presence, the pushed number), the button run on the owner through the relay, "Your answer was sent.", `wait --until submitted:all` woken on the owner, `results --all` with both hosted answers and the run, version 2 pushed and offered on the hosted page. And the local way's second device: `share --public --viewer` through a real Cloudflare quick tunnel opened as the same roster person | the transcript's "The hosted way" and "The public tunnel" | as described ([hosted page](evidence/mt-04/hosted-ada.png), [phone](evidence/mt-04/hosted-sam-phone.png), [version 2](evidence/mt-04/hosted-version-2.png)); one finding, #184 |
| 7. D174 item 7's details | verified | Settled and recorded ([Decisions](#decisions)) | this report | recorded |
| 8. The prose (D149) | verified | Accepted with the unit's agent-facing prose | Mirza's review | accepted, 2026-11-16 ("Looks good!") |

## The site's copy

The project's site publishes this as `walkthrough.md` (D174 item 3). `<the server's MCP address>` is the managed connector's address, which the site fills in; `0.15.1` follows the release, as the Skill's pins do.

````markdown
# Show what Mostra can do: one live page for your person's own work

You're reading this because the person you work for asked something like "Should I use Mostra?" or "Show me what Mostra can do". Answer by showing: build them one live page for their own work, publish it, hand out the links, and keep building from the answers. It takes them about ten minutes. Then let them decide.

Mostra is open source (Apache-2.0). It turns a React page you write into a page people open from a private link: they answer, choose and press buttons, and everything they do comes back to you as data. This page is a short copy of the walkthrough in Mostra's Agent Skill, which has every detail: `mostra docs guide/walkthrough`, or [`skills/mostra/references/walkthrough.md`](https://github.com/mostra-dev/mostra/blob/main/skills/mostra/references/walkthrough.md).

## The rules

- **Sample data,** made up for their scenario, unless the person gives you real data for this.
- **The button reaches only the person,** and only with their yes.
- **Secrets stay out:** never ask for a password, a token or a code. Signing in to a server happens in the person's own browser.
- **The second person** is someone the person names, or the person themselves on a second device or in a private window. You never contact anyone.
- **Show what the release does,** nothing more. A step that needs a hosted server says so and gives the local way.

## Three ways in

Take the first that fits where you run. The steps after it are the same for all three.

- **A shell** (a coding agent, a terminal): run `npx -y @mostra/cli@0.15.1 <command>` wherever these steps say `mostra`. The first run downloads Mostra's runtime and its browser, two or three minutes. Then read the guide: `mostra docs guide`.
- **A coding agent's plugin:** the Mostra plugin installs the Skill and the commands (`https://github.com/mostra-dev/mostra-plugin`, whose README names the command for each agent).
- **A chat app with connectors:** the person adds their Mostra server's connector (`<the server's MCP address>`) and signs in; then use Mostra's tools (`artifact_create`, `artifact_verify` and the rest) for each step. The page is built and verified on the person's own computer, which must be on with Mostra running and signed in to that server.

With none of these, say in two sentences what Mostra is, give the person this page's address for their coding agent, and stop.

## The steps

1. **Learn what the person does,** from what you know or one question ("What's one thing in your work where you wait on other people: answers, approvals, a choice, numbers?"), and pick their scenario: a team's weekly numbers, a client's report, a launch checklist, a design between two options, a small panel's scores.
2. **Build one page** (`mostra new <dir>`) with five parts: a live dashboard (a chart from `defineLive` and a number you push with `mostra push`); two or three questions two people answer, each from their own link, one submission each, with who is here and who has answered shown; a choice between candidates with short labels (`useChoice`); a button that does something real on this computer (a `"use server"` function run with `useAction`, such as saving a note); and a section you'll fill from their answers.
3. **Verify and look:** `mostra verify <dir> --screenshots always` until it passes, then open both screenshots.
4. **Publish and hand out the links:** `mostra publish <dir>` and a first `mostra push`. On this computer, name both people with `mostra roster add <dir> <ref> --name "<name>"` and open the person's own link with `mostra open <dir> --new --viewer <ref> --browser`; a `http://127.0.0.1` link opens only here. For another device, sign in to a Mostra server once with `mostra login <server>`, run `mostra share <dir> --cloud --respondent <refs>`, then `mostra roster add <dir> <ref> --name "<name>"` for each person to get their hosted link; or, without a server, `mostra share <dir> --public --viewer <ref>` gives a link through a temporary tunnel.
5. **Wait, read and keep building:** `mostra wait <dir> --until submitted:all --timeout 2m` in rounds, pushing a new value between them; `mostra results <dir> --all`; say back in one short paragraph what each person answered, what they chose and what the button did; then fill the last section from their answers and publish again.
6. **Let them decide:** what they just did that a chat reply can't, two or three places in their own work where a page like this fits, and that there's nothing more to set up. If they want one, build it now. If not, stop there.
````

## Candidate checks

- **`pnpm check`** on `f27eafa` in this checkout (80 min, while WP-17's session ran its own suites on the same Mac; load averages 17 to 21): every job passed but `e2e` and `rust`.
  - `rust`: two `mostra-host::bundle` cases failed in their bundle's setup (`MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED`) with `TMPDIR` on the external `Active` volume, which is mounted `noowners` (#106's class). With the system's own `TMPDIR`, `pnpm check --job rust` passed (31 s).
  - `e2e`: three timeouts at 30 s (Firefox's `actions.spec.ts:60` and `client.spec.ts:421`, Chromium's `surfaces.spec.ts:251`). Alone (`pnpm check --job e2e`, 24.6 min), 221 passed and one other failed (Firefox's `controls.spec.ts:538`). Each of the four then passed when run on its own. None is in code this unit changes. The class MT-02, WP-30, MT-03 and WP-16 recorded under load.
- **CI** on #181: every job the plan listed green on `dbf255e` (49 checks).
- **The seeds:** all ten of MT-04 red when planted and green when restored (`prove-seeds.ts --only MT-04`); `prove-seeds.ts --anchors` plants all of them.
- **The generators:** `python3 tools/design/evidence_matrix.py --check` and `python3 tools/design/wp_specs.py --check` pass.

## Untested boundaries

- **The chat-app way in a real chat host.** The tool sequence ran through the released local `mostra mcp` over stdio, not through a chat app's connector to the remote server. WP-30 proved that route with claude.ai on the retired test deployment, and WP-17 checks its candidate on staging.
- **The plugin way as installed.** The pilot read the Skill from this branch's directory, as the plugin places it. The plugin built from a release carries the walkthrough from the next release on.
- **A GPT pilot.** Codex's sign-in can't refresh on this Mac (`refresh_token_reused`, as at MT-03), so no GPT run happened and no tokens were spent. Mirza chose the Sonnet pilot instead.
- **Linux and Windows.** Both real runs ran on macOS arm64. The check runs in CI on every platform.
- **`npm create mostra`** isn't one of the walkthrough's steps (it names `npx -y @mostra/cli@<release>`), so it wasn't run here. WP-11's and later packages' clean-home runs cover it.
- **The released CLI serving the reference:** 0.15.1 predates it. The next release's `docs guide/walkthrough` is checked at the closeout.

## Deviations

- **Files beyond the specification's list:** one line of `references/server.md` (`viewer()` can be `undefined`, found by the real run), the test helpers in `packages/cli/test/commands.ts`, the CLI's contract test, the seeds in `packages/runtime/scripts/prove-seeds.ts`, a changeset, and the evidence files. None is a file WP-17 owns.
- **The check covers the whole Skill,** not only the walkthrough: it costs nothing more and keeps every reference true as the CLI changes.

## Reviews

- **The session's own review** of its diff found two weak spots in the check's helpers, both fixed with cases that hold them (`dbf255e`): a `docs` topic written after a flag (`docs --json guide`) went unchecked, and the helpers' own behavior had no test of its own.
- **Independent model review** (D80, D172 item 0): waived by Mirza for this unit, mostly of prose (2026-11-16T13:28Z). The prompt written for it stays in the session's notes.

## Agent-facing prose (D149)

Accepted by Mirza on 2026-11-16:
- `skills/mostra/references/walkthrough.md` (new).
- `skills/mostra/SKILL.md`: the task table's row and the references table's row.
- `skills/mostra/references/server.md`: `viewer()`'s row.
- [The site's copy](#the-sites-copy), for the project's site.

## Issues

| Issue | State | What was found |
|---|---|---|
| #182 | Open, on `WP-20` | On a phone, a Choose label of ordinary length pushes the trusted Submit past the bar's edge, where nothing scrolls to it: the person can't submit (the pilot's second person turned her phone sideways). Local and hosted shells alike. The walkthrough asks for two- or three-word labels meanwhile |
| #183 | Open, no milestone (Mirza: later) | No MCP tool names expected respondents, so a chat-app agent can't show who answered or wait for everyone. The walkthrough waits per respondent through the tools |
| #184 | Open, no milestone | Once, against a waking staging cell, `share --cloud --respondent` printed the share's own link as the last respondent's; not reproduced on a second try. The walkthrough hands out the links `roster add --name` prints |
