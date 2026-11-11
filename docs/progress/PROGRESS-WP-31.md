# WP-31 progress: teams

**Status:** In progress. Owns CO-01, CO-02, CO-03, CO-04, CO-05 and CO-07 ([specification](../design/work-packages/WP-31.md)), and the issues on the `WP-31` milestone (#132, #135).

## Baseline

| | |
|---|---|
| Branch | `wp/31-teams`, created from `origin/main` |
| Starting `HEAD` | `9215aeb` (`origin/main`, 2026-11-10: "docs: WP-30's closeout, Mostra 0.11.0, WP-31 next (#137)") |
| `git status` | clean |
| `pnpm check` | on `9215aeb` in a detached worktree on the external `Active` disk (`/Volumes/Active/mostra-wp31-baseline`, macOS 26.2 arm64, Node 24.22.1, pnpm 12.14.0), after a fresh `pnpm install --frozen-lockfile`: format-lint, types, hygiene, e2e, build, boundaries, api, licenses, rust, docs and commits passed; `unit`, `integration` and `conformance` failed while every job ran at once and the laptop's internal disk filled up (2.7 GiB free at the start; `disk I/O error` in the conformance kit's homes, the npm bootstrap's bundle install, the Rust gate seeds), beside the known load timeouts (`gc.test.ts`'s VR-06 and the fields property, MT-02). The three jobs re-run alone once 17 GiB were freed (the repository's Rust `target/` and two stale runtime bundles, 0.6.2 and 0.8.0, in Mostra's own cache): `unit` passed in 540 s, `integration` in 677 s and `conformance` in 540 s. The baseline is green |
| Predecessors | WP-30 ([PROGRESS-WP-30](PROGRESS-WP-30.md)) and WP-07 ([PROGRESS-WP-07](PROGRESS-WP-07.md)) on `origin/main`; no `RECOVERY-WP-31-*.md` |
| Milestone `WP-31` | #132, #135; #39, #46, #55, #85, #95, #111 and #124 stay on no milestone (D155 item 7) |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |

## Decisions

- **D168** (proposed under D123, brought with the candidate): the roster as a resource of its own with personal links that are ordinary `view/url` links; durable `roster.changed` and `roster.completed` events for hosts only; rounds under `once` per viewer and `epochs`; `submitted:all` and `submitted:<N>` read from the events (so an owner instance answers them, once it holds every submission a completion names); status `not-opened`, `drafting`, `submitted`; presence in memory only, rate-limited and coalesced, opt-in per hook; attribution with a per-artifact `vk_` key; the visibility policy; the roster on a hosted home, `share/start`'s `respondents`, `roster.completed` for the operator and the `invitations` port; the CLI; the kit's team scenarios; the e2e measures for #132 and #135.
- **M62** (2026-11-11): Mirza delegated the visibility default ("I trust you to make the most robust … decision"); it is `private` unless the manifest opts in (`counts` or `names`), the owner seeing everyone (D168 item 8).

## Slices

| Commit | Slice |
|---|---|
| `0e005e9`, `bd00bc7` | This report's baseline |
| `74888f3` | `@mostra/protocol`: `roster/*`, `results/list`, `share/start`'s `respondents`, the waits, the manifest's `team`, the team wire shapes, the `TEAM` diagnostics |
| `8f631fe` | The runtime's roster (migration 16), rounds and waits, status, presence, the visibility projection, the gateway's routes; `@mostra/react`'s `useRespondents`, `usePresence` and attribution |
| `b6025ba` | Generated schemas, API reports, Rust wire types and diagnostic pages |
| `3b8f986`, `199060d` | Hosted rosters, `roster.completed` for operators and the `invitations` port (directory migration 4) |
| `23e26a3` | `mostra roster`, `results --all`, `share --respondent`, the team waits in the CLI and MCP |
| `390eee3` | The Skill's `teams.md` |
| `06604ed`, `1fde2d4` | Integration suites through a real daemon and a real remote server; the CLI contract and the team client's timing |
| `5e2b6cf` | The five-viewer browser scenario (J14) in three engines |
| `d2ff0f2` | The conformance kit's `team.roster` and `team.waits` |
| `7d56270` | #132's and #135's e2e measures |
| `0b97a72` | Sixteen seeded violations; each team case stands alone |
| `2340045`, `b98eda3`, `84289be` | D168 and the dossier, the AGENTS.md files, the verified facts |

## Evidence

Every check runs through the real interface: a real daemon (`GatewayHome`) or a real `mostra-runtime server` with real owner daemons, pages through the real gateway and shell (`Browser` and Playwright), the CLI's built binary, the conformance kit driving the reference hosts. Each row's seeded violations (`node packages/runtime/scripts/prove-seeds.ts --only <ID>`) go red when planted and green when restored.

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| CO-01 | verified | A roster of five gives five personal links that open as five viewers, each the roster's own; adding them again (or a `requestId` replay) keeps every link; roster changes are a durable `roster.changed` hosts read and pages never see; the CLI's `roster add\|get\|remove` (arguments, `--stdin`, a usage error, plain and `--json` output); on a remote server `share --cloud --respondent` names them on the hosted home, each link a hosted link, and the operator's `invitations` receives one per respondent with an email, queued by token without the link's secret and handed over with the respondent's own link; the kit's `team.roster` on the TypeScript and Rust reference hosts; five people on five links in a browser (J14) | `vitest --project integration team.test.ts team-hosted.test.ts`; `packages/cli` `contract.test.ts`; `mostra-conformance --only team.roster` (both hosts, every mode); `tests/e2e/specs/team.spec.ts`; `prove-seeds.ts --only CO-01` | 8 + 1 integration tests pass; the contract's 19 pass; `team.roster` passes on both hosts in every mode; J14 passes in Chromium, Firefox and WebKit; 2 seeds red, then green |
| CO-02 | verified | A property test over random interleavings of submissions and roster changes: under `once` per viewer and `epochs` the roster completes exactly when the last expected respondent submits, once per completion, and `submitted:all` and `submitted:<N>` agree with a model; refusals under `once` per artifact (`MOSTRA_TEAM_ROSTER_POLICY`) and `none`; an empty roster never completes, and a completion survives compaction; through a daemon `submitted:all` answers exactly at the fifth submission with `roster.completed` naming all five, and `submitted:3` at the third; an owner instance answers only once it holds every submission a followed completion names; on a remote server the owner wakes at the last hosted answer with all three imported; the kit's `team.waits` (both policies, every answer delivered); the CLI's exit 1 for the refusal; J14's agent wakes at the fifth answer | `vitest --project unit team.test.ts`; `vitest --project integration team.test.ts team-hosted.test.ts`; `mostra-conformance --only team.waits`; `team.spec.ts`; `prove-seeds.ts --only CO-02` | 10 unit tests pass (the property at 25 interleavings per policy); integration and kit pass; 4 seeds red, then green |
| CO-03 | verified | Each respondent moves from `not-opened` to `drafting` to `submitted`; the status `roster/get` gives a host, the one `mostra roster get --json` prints and the one five pages show through `useRespondents` agree after one answer; a page learns no `ref` or viewer ID | `vitest --project unit team.test.ts`; `team.test.ts` (integration); `team.spec.ts` (hook, protocol and CLI compared in the browser test); `prove-seeds.ts --only CO-03` | pass in the three engines; 2 seeds red, then green |
| CO-04 | verified | Cursors from three viewers reach each other by name; a moving cursor reaches another page as an ephemeral message on its poll; past 20 posts a second a view gets 429 `MOSTRA_TEAM_PRESENCE_RATE_LIMITED` with `Retry-After`; a viewer who leaves is gone for the others at once, and in the browser one who stops sharing is seen without a cursor; after presence with a marker cursor and selection, no table and no row of the ledger holds them; the client joins on mount, renews every 10 s, leaves with its last hook and waits out the rate | `team.test.ts` (integration); `team.spec.ts`; `packages/react` `team.test.ts`; `prove-seeds.ts --only CO-04` | pass; 3 seeds red, then green (one through the browser test) |
| CO-05 | verified | Two viewers edit a shared field: each sees the other's name and key as its writer, the key the roster gives that person, never the viewer ID; in the browser the other page says "Grace" and the writer's own says "you" | `team.test.ts` (integration); `team.spec.ts`; `prove-seeds.ts --only CO-05` | pass; 2 seeds red, then green |
| CO-07 | verified | `private`, `counts` and `names` each return exactly their promise to a respondent's `respondents` and `presence` (own entry only; counts and the number here; everyone by name with cursors), and everything to the owner's; the default is `private` (M62) | `vitest --project unit team.test.ts`; `team.test.ts` (integration); `prove-seeds.ts --only CO-07` | pass; 3 seeds red, then green |

## Issues on the milestone

| Issue | State | What was done |
|---|---|---|
| #132 | Open, evidence added | Measured on macOS through the hosted spec: every TIME_WAIT is on the browser's ports, none on Mostra's listeners, so a shell page's own `ERR_NO_BUFFER_SPACE` is Chromium's random port colliding with its own TIME_WAIT, which Chromium's source confirms has no reuse delay on Windows (VERIFIED_FACTS, WP-31). The e2e helpers load a shell page again once for exactly that error and record it on the test (`gotoShell`); randomization stays on (D157). What a Windows run shows goes on the issue |
| #135 | Open, diagnosable | `openInShell` waits for the frame's body within 20 s once the shell is ready, and otherwise names Playwright's frame tree, so the next occurrence on Windows Firefox shows what Playwright held |
