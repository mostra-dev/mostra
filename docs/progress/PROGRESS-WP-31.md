# WP-31 progress: teams

**Status:** Candidate, brought to Mirza for acceptance. Owns CO-01, CO-02, CO-03, CO-04, CO-05 and CO-07 ([specification](../design/work-packages/WP-31.md)), and the issues on the `WP-31` milestone (#132, #135).

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
| `2f237cc` | The session's own review: presence's rate held across a leave and a join again, with a unit suite for the team traffic |
| `3aa4e71` | The Skill's team sample as a complete module (found by the full `pnpm check`) |
| `a5f6f7c` | #135's measure: a ready shell's frame Playwright can't reach loads again once, every diagnostic read bounded |
| `bad96d4`, `f74fbe7` | The Claude Opus review's ten findings, each with a test and a seed (Reviews) |

## Evidence

Every check runs through the real interface: a real daemon (`GatewayHome`) or a real `mostra-runtime server` with real owner daemons, pages through the real gateway and shell (`Browser` and Playwright), the CLI's built binary, the conformance kit driving the reference hosts. Each row's seeded violations (`node packages/runtime/scripts/prove-seeds.ts --only <ID>`) go red when planted and green when restored.

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| CO-01 | verified | A roster of five gives five personal links that open as five viewers, each the roster's own; adding them again (or a `requestId` replay) keeps every link; roster changes are a durable `roster.changed` hosts read and pages never see; the CLI's `roster add\|get\|remove` (arguments, `--stdin`, a usage error, plain and `--json` output); on a remote server `share --cloud --respondent` names them on the hosted home, each link a hosted link, and the operator's `invitations` receives one per respondent with an email, queued by token without the link's secret and handed over with the respondent's own link; the kit's `team.roster` on the TypeScript and Rust reference hosts; five people on five links in a browser (J14) | `vitest --project integration team.test.ts team-hosted.test.ts`; `packages/cli` `contract.test.ts`; `mostra-conformance --only team.roster` (both hosts, every mode); `tests/e2e/specs/team.spec.ts`; `prove-seeds.ts --only CO-01` | 8 + 1 integration tests pass; the contract's 19 pass; `team.roster` passes on both hosts in every mode; J14 passes in Chromium, Firefox and WebKit; after the Opus review, a re-added respondent keeps their link only while it matches the request's scopes, version and expiry, the forwarded `roster/add`'s links are protected, an invitation that can't build its link holds no other back and is bounded (`operator-invitations.test.ts`), and the operator's limit counts only links minted; 7 seeds red, then green |
| CO-02 | verified | A property test over random interleavings of submissions and roster changes: under `once` per viewer and `epochs` the roster completes exactly when the last expected respondent submits, once per completion, and `submitted:all` and `submitted:<N>` agree with a model; refusals under `once` per artifact (`MOSTRA_TEAM_ROSTER_POLICY`) and `none`; an empty roster never completes, and a completion survives compaction; through a daemon `submitted:all` answers exactly at the fifth submission with `roster.completed` naming all five, and `submitted:3` at the third; an owner instance answers only once it holds every submission a followed completion names; on a remote server the owner wakes at the last hosted answer with all three imported; the kit's `team.waits` (both policies, every answer delivered); the CLI's exit 1 for the refusal; J14's agent wakes at the fifth answer | `vitest --project unit team.test.ts`; `vitest --project integration team.test.ts team-hosted.test.ts`; `mostra-conformance --only team.waits`; `team.spec.ts`; `prove-seeds.ts --only CO-02` | 10 unit tests pass (the property at 25 interleavings per policy); integration and kit pass; an imported submission that completes a roster held on the owner settles it in its transaction (`imports.test.ts`, Opus review 5); 5 seeds red, then green |
| CO-03 | verified | Each respondent moves from `not-opened` to `drafting` to `submitted`; the status `roster/get` gives a host, the one `mostra roster get --json` prints and the one five pages show through `useRespondents` agree after one answer; a page learns no `ref` or viewer ID | `vitest --project unit team.test.ts`; `team.test.ts` (integration); `team.spec.ts` (hook, protocol and CLI compared in the browser test); `prove-seeds.ts --only CO-03` | pass in the three engines; one roster read serves every following page (`team-traffic.test.ts`, Opus review 9); 3 seeds red, then green |
| CO-04 | verified | Cursors from three viewers reach each other by name; a moving cursor reaches another page as an ephemeral message on its poll; past 20 posts a second a view gets 429 `MOSTRA_TEAM_PRESENCE_RATE_LIMITED` with `Retry-After`; a viewer who leaves is gone for the others at once, and in the browser one who stops sharing is seen without a cursor; after presence with a marker cursor and selection, no table and no row of the ledger holds them; the client joins on mount, renews every 10 s, leaves with its last hook and waits out the rate | `team.test.ts` (integration); `team.spec.ts`; `packages/react` `team.test.ts`; `prove-seeds.ts --only CO-04` | pass; after the Opus review, an update that reaches the gateway after the page's leave changes nothing (`seq`), the page ignores the answer to a post made before it left, and a page back from the back/forward cache joins again (`packages/react` `test/browser/team.test.tsx`, Chromium); 7 seeds red, then green (one through the e2e and one through the React browser test) |
| CO-05 | verified | Two viewers edit a shared field: each sees the other's name and key as its writer, the key the roster gives that person, never the viewer ID; in the browser the other page says "Grace" and the writer's own says "you" | `team.test.ts` (integration); `team.spec.ts`; `prove-seeds.ts --only CO-05` | pass; 2 seeds red, then green |
| CO-07 | verified | `private`, `counts` and `names` each return exactly their promise to a respondent's `respondents` and `presence` (own entry only; counts and the number here; everyone by name with cursors), and everything to the owner's; the default is `private` (M62); after the Opus review, other viewers' submission events reach a page only as the policy allows (none under `private`, without name or key under `counts`, all of them under `once` per artifact), and a view hears presence only when what it may see changed | `vitest --project unit team.test.ts team-traffic.test.ts`; `team.test.ts` (integration); `prove-seeds.ts --only CO-07` | pass; 6 seeds red, then green |

## Issues on the milestone

| Issue | State | What was done |
|---|---|---|
| #132 | Open, evidence added | Measured on macOS through the hosted spec: every TIME_WAIT is on the browser's ports, none on Mostra's listeners, so a shell page's own `ERR_NO_BUFFER_SPACE` is Chromium's random port colliding with its own TIME_WAIT, which Chromium's source confirms has no reuse delay on Windows (VERIFIED_FACTS, WP-31). The e2e helpers load a shell page again once for exactly that error and record it on the test (`gotoShell`); randomization stays on (D157). What a Windows run shows goes on the issue |
| #139 | Filed, no milestone | Found on this package's full CI run, in WP-29's code: an owner's log can hold two imported hosted submissions out of the server's order (the follow importing a missing submission before an earlier delivery lands); every answer still arrives once. For the next package that touches the owner's link |
| #135 | Open, narrowed | #138's full CI run (43012158370) met it on `hosted.spec.ts:109`: the shell was ready (its frame's runtime had greeted it), the bounded wait for the frame's body fired after 20 s, and then Playwright's own evaluation in the frame never returned, so the diagnosis itself hung until the test's limit (the trace). Playwright's Windows Firefox loses the frame's execution context while the page works. `openInShell` now loads the page again once when Playwright reaches no body in a ready shell's frame, recorded on the test, and fails at once naming the frame tree otherwise; every read of the diagnosis is bounded (3 s). The team spec passed on the same leg |

## Candidate checks

- **`pnpm check`** on `a115639` in the detached worktree on the external disk (fresh `pnpm install --frozen-lockfile`, 53 min): every job passed but `integration`, where one case failed for a real defect: the Skill's `teams.md` sample used a component it never declared, and verify type-checks and renders every sample (`verify.test.ts`). Fixed in `3aa4e71`; the case passes alone. The fix of `2f237cc` (after that run) passed its own unit suite, the team integration suite and every CO-04 seed.
- **CI** on #138 with `ci:full` (every leg: Linux, macOS, Windows x64 and arm64, every engine, the six-platform release rehearsal): run 43012158370 on `3aa4e71` failed only Windows Firefox's `hosted.spec.ts:109`, #135, whose trace narrowed it (Issues, below); run 43019630810 on `ea5763f`, with `a5f6f7c`'s measure, passed Windows Firefox and every other leg but two, unrelated to WP-31 and green on their re-run: `integration (macos, remote)`'s RM-08 order check (two imported answers out of the server's order, filed as #139: a race between the owner's follow and its deliveries, WP-29's paths) and `integration (windows-arm64, windows-clients)`'s SDK verify (a stylesheet failed with `ERR_NO_BUFFER_SPACE` inside verify's own browser, recorded on #132). After the re-run all 74 jobs are green, `ci-ok` included. Run 43048370674 on `f74fbe7`, with the Opus review's fixes, passed every leg the first time: 78 of 78 checks, Windows Firefox's hosted cases included.

## Reviews (D80, D144)

- **The session's own review** of its diff found one defect, fixed with a test and a seed red on the old code (`2f237cc`): a leave took no token and removed the view's presence bucket, so leaving and joining again refilled the rate, and a leave of a view that wasn't present cost a scan of every present view without any limit. Writing the seeds found two weak checks, both strengthened (`0b97a72`): cases that depended on an earlier case's pages, and an owner-instance guard the hosted suite didn't hold.
- **GPT-6.1-Sol** (`codex review`): blocked. This machine's Codex sign-in has expired (`refresh_token_reused`), so no review ran and no tokens were spent; it needs `codex login` by Mirza.
- **Claude Opus 5.5** (D144), run by Mirza on `85f7caf` and posted on #138: ten findings, three ranked P1, each verified against the code before it was fixed, and each fixed with a test and a seed red on the old code (D168, "Refined after the Claude Opus review"):
  1. (P1) Under `private`, the key on another viewer's `submission.created` told a page who submitted; before WP-31 the event even carried their name. Other viewers' submission events now follow the visibility policy, under `once` per artifact every page still hears of the one submission (`team.test.ts` unit, two seeds).
  2. (P1) Presence reached a `private` view on every change by others, so its timing showed others were here. A view now hears presence only when what it may see changed (`team-traffic.test.ts`, seed).
  3. (P1, narrower than ranked) A forwarded `roster/add`'s hosted links weren't registered with the owner's redactor. The redactor's own pattern already masks every `#t=…` in text, so a URL never leaked; the bare secret could. Every capability link a forwarded answer carries is now protected; the hosted test writes the bare secret into an event and reads it back redacted (`team-hosted.test.ts`, seed).
  4. An invitation whose home couldn't build its link retried forever at the head of the queue and blocked every other invitation, and building the link was unbounded. Invitations now have no order (each waits for its own retry), building the link is bounded like the hand-over, and a home the directory no longer has drops its invitations (`operator-invitations.test.ts`, two seeds).
  5. An imported submission never settled the roster. It now settles it in the import's transaction and notifies the pages that follow it (`imports.test.ts`, seed).
  6. `roster/add` kept a live link whatever the request asked for. A respondent now keeps their link only while it is the one the call would mint (scopes, pinned version, expiry), the old one not revoked (`team.test.ts` integration, seed; writing the seed showed the first version of the test changed two properties at once, so it was rewritten to change one per step).
  7. A leave could be overtaken by an update in flight, bringing the view back for 30 s, and the late answer updated an unmounted hook. Presence posts now carry the page's own count (`seq`, additive), the gateway takes no older post (which still takes its token), and the page ignores answers to posts made before it left (`team-traffic.test.ts`, `packages/react` `team.test.ts`, two seeds).
  8. A page restored from the back/forward cache stayed absent. It joins again on `pageshow` (`test/browser/team.test.tsx` in Chromium, seed).
  9. Each settle read the roster once per following view, and each fan-out scanned every artifact's present views. One read serves every following view, and present views are indexed by artifact (`team-traffic.test.ts`, seed).
  10. The operator's limit counted respondents whose links are kept. `roster/add` now asks for exactly the links it will mint, none for a replay (`team-hosted.test.ts`, seed).

## Untested boundaries

- **Against a deployed server.** The hosted roster, invitations and `roster.completed` ran against a real `mostra-runtime server` on this machine, not against WP-30's test deployment, which runs 0.11.0 and would need the candidate's image.
- **Windows.** The new suites run on the Windows legs in CI (`windows-gateway`, `windows-remote`, Chromium and Firefox e2e); #132's retry and #135's measure show their worth only when those engines meet the failures again.
- **Many viewers.** Presence was measured with five pages and the rate with one fast view; a page with hundreds of present viewers is bounded by design (200 named peers, one coalesced message per 50 ms) but not load-tested.

## Deviations

- **`share/start`'s `respondents`** is for shares to a remote server only (INTERFACES §18.9 named it for `share/start` in general): over a tunnel each viewer is already their own (D158 item 2), and `roster/add` names respondents with local personal links (D168 item 9).
- **No MCP tool for the roster.** The waits reach MCP through `artifact_wait`; a roster tool would join the frozen tool set additively later (D168 item 10).

## Agent-facing prose for review (D149)

- The Skill: `references/teams.md` (new), the pointers in `SKILL.md`, `references/answers.md`'s wait conditions and `results --all`.
- CLI help: `mostra roster get|add|remove`, `wait --until`'s summary, `results --all`/`--after`, `share --respondent`.
- Diagnostic hints and pages: `MOSTRA_TEAM_ROSTER_POLICY`, `MOSTRA_TEAM_ROSTER_TOO_LARGE`, `MOSTRA_TEAM_PRESENCE_RATE_LIMITED`.
- The MCP `artifact_wait` description's team conditions.
- The `AGENTS.md` of `@mostra/runtime`, `@mostra/react`, `@mostra/protocol`, `@mostra/cli` and `@mostra/conformance`.
