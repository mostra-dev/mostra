# WP-29 progress: remote transport and relay

**Status:** Done. Accepted by Mirza on 2026-11-07 (M59: "absolutely incredible. 100% accepted & approved -- let's go ahead and meticulously close out this WP in the best, most robust way.") with D166, the package's agent-facing prose (D149) and RM-02's external check left to WP-30; merged to `main` through the merge queue as `1ad9def` (#128) and released as Mostra 0.10.0 (#131). Owns RM-01, RM-02, RM-04 and RM-07 ([specification](../design/work-packages/WP-29.md)), and the issues on the `WP-29` milestone (#114, #116, #118, #119).

## Baseline

| | |
|---|---|
| Branch | `wp/29-remote-relay`, created from `origin/main` |
| Starting `HEAD` | `a6f974f` (`origin/main`, 2026-11-05: "docs: WP-28's closeout, WP-29 next (#127)") |
| `git status` | clean |
| `pnpm check` | green on `a6f974f` in a detached worktree on the external `Active` disk (`/Volumes/Active/mostra-wp28-baseline`, macOS 26.2 arm64, Node 24.22.1, pnpm 12.14.0): every job passed (format-lint, types, unit, integration, hygiene, e2e, build, boundaries, api, licenses, rust, conformance, docs, commits) in 27 min 35 s of wall time, after a fresh `pnpm install --frozen-lockfile`. No failure was already present |
| Predecessors | WP-28 done ([PROGRESS-WP-28](PROGRESS-WP-28.md) on `origin/main`); no `RECOVERY-WP-29-*.md` |
| Milestone `WP-29` | #114, #116, #118, #119; #39, #46, #55, #85, #95, #111 and #124 stay on no milestone (D155 item 7), #106 waits for the package that takes it |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |

## Candidate checks

- **`pnpm check`** on `b093424` in the detached worktree (fresh `pnpm install --frozen-lockfile`, 32 min): every job passed but `integration`, where one case, `verify.test.ts` "passes a single MDX page", met `MOSTRA_RUNTIME_NOT_READY` at 59.6 s while every job ran at once on this laptop; alone it passed (10 of 10 of its group). Every later commit ran its affected static jobs, unit and the suites it touched.
- **CI** on the pull request with `ci:full` (every leg: Linux, macOS, Windows x64 and arm64, every engine, the six-platform release rehearsal):
  - run 42325188141 on `99bde6a`: green. Earlier runs found what the suites' grouping and bounds needed (D166 item 21) and #129 (a Windows read of the install ID; retried, kept open until the Windows legs have run it more).
  - run 42384068943 on `68b5f8c`, after the Opus review's fixes: green. Its first attempt failed one case on Windows x64 Firefox, IN-02's journaled edit, whose shell never reached ready at its first open, before anything of WP-29's runs (#39, recorded there); the re-run passed.
  - CodeQL: two alerts fixed, four dismissed with reasons (Reviews, below).

## Decisions

- **M58** (2026-11-05): Mirza delegated WP-29's four open points (imported submissions' local rows, no built-in default server, `mostra login <server> --default`, external evidence against a deployed server with WP-30's test deployment): "I trust you to make the most robust decision". Recorded as **D166**, proposed under D123 and brought with the candidate: the tally (item 1), the shell's poll and #119 (2), the bundle (3), the server's configuration, sign-in and binding (4 to 6), imported submissions (7), no built-in default server (8), external evidence (9), hosted pages (10), remote shares (11), the relay (12), live producers over the relay (13), restores and incarnations (14), a link's domain (15), reading a lost submission again (16), the kit's remote scenarios (17) and the size budgets (18), a link's rate for relayed actions (19), and a run the owner refuses or never answers (20).
- **Found while building** (each fixed with a check red on the old code):
  - #119's cause: the shell long-polls the same view as its frame and took the frame's run and live messages.
  - A producer's failure crossed the relay unredacted (the secrets grep over relay traffic caught it).
  - The device page's own form was refused: `Referrer-Policy: no-referrer` makes browsers send `Origin: null` (a real browser caught it; the page now sends `same-origin`).
  - A version push queued after the owner's link had nothing left to push never went out: the drain stayed registered once it ended before its first await. The same pattern is closed in the token refresh and the page's resync.
  - A submission the owner lost to a restore of its own home was never delivered again (the hosted home counts it delivered): the owner now reads it again (`hosted/submission`).

## Reviews (D80, D144)

- **GPT-6.1-Sol** (`codex review`): not offered to this Codex account (a single-call pilot hung with no answer), as at WP-28; brought to Mirza.
- **Claude Opus 5.5**, run by Mirza against `eb549dd` (review on #128, 2026-11-07): thirteen findings, six P1, four P2, three unrated. Each is fixed with a check red on the old code and recorded in D166 item 22:
  1. (P1) A connected owner treated as offline: the newest session of a link is its own, a session that opened while an older one was held is resumed once it closes, and a failed reconcile is tried again (`hosted-relay.test.ts`, two seeds).
  2. (P1) Followed events lost on reconnect: a notification carries the session it came on, and a page that can't be copied ends the connection (`binding.test.ts`, seed).
  3. (P1) A failed read again lost a submission: missing submissions wait in `remote_missing`, written with the cursor, until imported (`restore.test.ts` with a first read that fails, seed).
  4. (P1) A run ending `succeeded` without its result: an update past what is held keeps nothing and asks the owner; a repeated run reports its whole state; an end carries its whole output (`hosted-relay.test.ts`, `relay.test.ts` "while the relay was cut", two seeds).
  5. (P1) Tenant file placement outside staging on a Windows server: listing paths are checked for every system and again where they land (`binding.test.ts` "listing path", seed).
  6. (P1/P2) A binding posing as the owner by its client name: a binding with ports must name its link, and a network binding's owner is only its link (`binding.test.ts` "own link", seed).
  7. (P2) An expired waiting run executed: a never-sent run past its limit ends `owner-offline` before anything sends it (unit, seed).
  8. (P2) `unknown` forever: sent runs that became `unknown` are reconciled (unit, seed).
  9. (P2) False `remote.regressed` at every reconnect: the hosted home keeps each link's reported mark (`relay_floor`) and a new link signs in with no marks (`restore.test.ts`, `relay.test.ts` "forgotten link", unit; three seeds).
  10. (P2) One refused push blocking the queue: refused pushes end, are named in `remote/status`, and later publishes go out (`hosted.test.ts`, seed).
  - Unrated: live values reach every server hosting the artifact (`hosted.test.ts` two servers, seed); each relayed step is said once in the owner's log (`relay.test.ts`, seed); a cancel pressed while the acknowledgement was on its way reaches the owner (unit, seed).
  - Its coverage gaps (secrets over the relay, migrations 12 and 13, additivity) stay covered by the checks above: the relay-traffic grep, the migration and trigger tests, and the wire-schema compatibility gate.
- **CodeQL** on #128: two file-system races fixed (`readBundle` reads through one handle; a test's stat-then-read removed); four alerts dismissed with reasons (a bearer token that is the credential checked; the owner's refresh token sent to the server it signed in to; the hosted shell's session secret in its own origin's storage, D165 item 8).

## Evidence

Every check runs through the real interface: a real `mostra-runtime server` on this machine, owner instances as real daemons, viewers through the real gateway or a real browser. Every row's seeded violations (`node packages/runtime/scripts/prove-seeds.ts --only <ID>`, 87 seeds for WP-29's four requirements) go red when planted and green when restored.

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| RM-01 | verified | A version exported as a bundle (directory or `.tar.zst`) is imported into a second home with the same artifact ID, version ID, digests and number, and its server code runs there; a tampered bundle (client file, planted file, manifest, identity, source) is refused with nothing kept; `WorkerLauncher` is documented as the future `SandboxPort` (INTERFACES §7, `workers/launcher.ts`); the MCP server keeps nothing between calls (every tool takes a handle; a second server continues from the handle alone) | `vitest --project integration test/integration/bundle.test.ts`; `packages/cli` contract test (`mostra export`, `mostra run`); `packages/mcp` `server.test.ts` "stateless"; `prove-seeds.ts --only RM-01` | 4 + 1 + 1 tests pass; 3 seeds red, then green |
| RM-02 | validated | Two instances on one machine, one `mostra-runtime server`: `mostra login` by the device grant (the device page in a real browser), `share --cloud`, the hosted page opened and answered in Chromium, Firefox and WebKit, the respondent told "Your answer was sent." with no delivery state, `wait` returning and the owner's host receiving each submission once through its outbox (also across a sign-out and sign-in); a push sends only the missing client files and never server code (a grep over the data directory); a binding silenced past 45 s reconnects through a proxy that drops idle connections at 60 s; a second instance of the account receives nothing; signing out and in keeps the instance link; a binding closes at its token's expiry unless refreshed in band, and within the bound of a revocation; the server's and each home's locks refuse a second process and are released by a crash; a network filesystem is refused; Litestream replicates a live hosted ledger and restores every answer; a closed home opens in 28 ms at the 95th percentile (target 250); a hosted data directory restored from a lagging copy under traffic rotates its incarnation on the owner's word, drops an update for a run it no longer knows, gives a page above its head a fresh snapshot, and the owner keeps what it imported, follows on and records `remote.regressed`; an owner restored to before an answer reads it again once; one artifact shared to two servers; issued links keep their domain when the active one moves; the kit's `remote.delivery` passes against the TypeScript and Rust reference hosts in every mode. External (the same against a deployed server) is WP-30's test deployment (D166 item 9) | `vitest --project integration` (server, binding, heartbeat, link, hosted, restore, replicator with `MOSTRA_TEST_LITESTREAM`); `tests/e2e/specs/hosted.spec.ts` (`MOSTRA_E2E_BROWSER=chromium`, `firefox`, `webkit`); CLI contract test "login, share --cloud, status and logout"; `mostra-conformance --only remote.` against both reference hosts; `prove-seeds.ts --only RM-02` | every suite passes on macOS; 45 seeds red, then green; external not run (WP-30) |
| RM-04 | verified | A counting fake mail action pressed on the hosted page runs once on the owner, with the owner's secret; owner offline: under `queue` the run waits and runs once on return, in order and at the drain rate (measured where the owner records each run), under `fail` it ends at once, and past the cap a run is refused before it is recorded; a cancel before it is sent ends it there; the relay cut mid-run: the owner finishes and reports, and past the offline limit the run is `unknown`, which the owner's end replaces once; a crash of the owner mid-run ends it `failed`, `interrupted`, reported on reconnect; a repeated relay message starts nothing; a lost acknowledgement is resent and joins, and the mail is sent once; a run the connected owner never answered is sent again, and one it refused ends `failed`, `owner-refused` (unit); an owner restored to before runs it accepted makes them `unknown`, never resent; reconciling comes before the waiting runs drain (unit); relay sequences continue above the owner's mark; a relayed run's state, signals and host events land on the hosted home; live producers run on the owner while a hosted page views and their values stay on the hosted home, flagged `ownerOffline` when it's away (to the page through `useLive`); D159's default refuses a page with no named person, and a link past its rate is refused with `Retry-After` before anything is recorded; a grep over every binding message finds no secret; the kit's `remote.relay` passes against both reference hosts | `vitest --project integration test/integration/relay.test.ts`; `vitest --project unit test/unit/hosted-relay.test.ts`; `packages/react` `server-client.test.ts`; `mostra-conformance --only remote.relay`; `prove-seeds.ts --only RM-04` | 14 + 11 + 2 tests pass; 33 seeds red, then green |
| RM-07 | verified | An artifact with a manifest tally: 300 submissions across three choices give exactly those counts in a hosted home (with the owner offline and no worker running) and in a local one; viewers receive the counts on the live channel; a value outside the listed choices, or any free text, counts nothing; `minTotal` shows only the total below it; a count never goes down, is never deleted or replaced (triggers); `live/push` can't write a tally key | `vitest --project unit test/unit/tally.test.ts`; `vitest --project integration test/integration/hosted.test.ts -t "tally"`; `prove-seeds.ts --only RM-07` | 6 + 1 tests pass; 6 seeds red, then green |

Issues on the milestone, each fixed at its root with a test as strict as before: #114 (`mostra open` says on stderr why no browser opened; the Skill says `--browser`; AX-01 seed), #116 (the Skill's "Approvals that do something"), #118 (a new `epochs` round shows no earlier "Submitted" card; e2e and an IN-13 seed), #119 (the shell's poll leaves its frame's ephemeral messages alone; an integration test under both launchers and an AC-02 seed).

## Untested boundaries

- **RM-02's external check** (the same flow against a deployed server) waits for WP-30's test deployment (D166 item 9, accepted at M59). Every other RM-02 check ran against a real `mostra-runtime server` on the same machine.
- **Litestream** replicating a live hosted ledger was run on macOS only (`MOSTRA_TEST_LITESTREAM`); CI has no Litestream binary and skips that case. WP-30 runs it where the container image runs.
- **A bundle whose lockfile names on-demand packages** a fresh home's store lacks: the importing home installs them from the lockfile before its worker starts (D135, WP-08's path), untested with a bundle here.
- **Version files' sweep after a removal**, pause, the operator ports and viewers of kind `account` and `anonymous` are WP-30's; WP-29 maps each hosted link to its own viewer (D166 item 10).
- **The relay's one accepted boundary** (FAILURE_MODEL §11.1): a run the owner recorded and started, whose acknowledgement was lost just before the owner's home was restored to an earlier backup, can run a second time when sent again.
- **Windows Firefox:** one CI run timed out filling a field of the hosted frame (passed on every later run), and IN-02's journaled edit and a Chromium `ERR_NO_BUFFER_SPACE` met #39 and #132 once each; none touched WP-29's code.

## Deviations

- **No `link_domain` table** (DATA_MODEL §7.2): a token's own `shell_origin` records the domain a link was minted on (D166 item 15).
- **Size budgets:** `@mostra/protocol`'s whole entry 54 to 60 kB and `@mostra/react`'s 53.5 to 54 kB, for the remote methods and the tally's types (D166 item 18).
- **Reviews:** GPT's D80 review was skipped (GPT-6.1-Sol isn't offered to this Codex account, as at WP-28; M59); Claude Opus reviewed once (D144).
- **The release playbook** (`docs/agents/release.md` step 3) now runs repository lint and the docs job on a version pull request instead of `pnpm check --affected`, at Mirza's suggestion: a version touches every package, so the local run repeated the pull request's own CI and its merge-queue run for half an hour.

## Commits and publication

- **Range:** `a6f974f..1ad9def` on `main`: the signed-off commits of `wp/29-remote-relay` (last `7288026`) and the merge commit `1ad9def` ([#128](https://github.com/mostra-dev/mostra/pull/128)), then the version pull request [#131](https://github.com/mostra-dev/mostra/pull/131) (`chore(release): Mostra 0.10.0`).
- **CI:** #128's last pull-request run (42398722244) and its merge-queue run green on every leg; #131's run (42405316779) green after one re-run of a Windows Chromium job (#132).
- **Publication:** Mostra 0.10.0 by the `Release` workflow (run 42410998541): the GitHub release `v0.10.0` with the six bundles, `SHA256SUMS` and attestations, every package of the release group on npm with provenance, the `mostra-host` crate on crates.io and the harness plugin's `v0.10.0`. The docs site doesn't exist yet (WP-26), so nothing deploys.
- **Remaining dirty paths:** none in the repository. Outside it: the baseline worktree `/Volumes/Active/mostra-wp28-baseline` (detached), logs in `/Volumes/Active/wp29-logs/`, scratch in `~/.jcode/scratch/` and `/Volumes/Active/wp29-scratch/`, and the Litestream binary in `/Volumes/Active/tools/litestream/`. The recovery checkpoint of session 1 was removed once this report superseded it. Mostra HQ was not written to: its roadmap and changelog lines for WP-29 wait for Mirza's go (D127).

## Issues at the closeout

| Issue | State | What was done |
|---|---|---|
| #114, #116, #118, #119 | Closed | Each fixed at its root with a test and a seed (Evidence, above); the `WP-29` milestone is closed |
| #129 | Open, on `WP-30` | A first-run process on Windows x64 read an empty install ID; the read is retried on sharing violations, a hypothesis kept open until the Windows legs have run it more. WP-30 touches the CLI |
| #132 | Open, on `WP-30` | Filed at the closeout: a shell page's own load failed with `ERR_NO_BUFFER_SPACE` on Windows Chromium (#66's cause at the top level). WP-30 changes the gateway's listeners |
| #39 | Open, no milestone | Met once more (Windows Firefox, IN-02's journaled edit); recorded on the issue (D155 item 7) |
| #46, #55, #85, #95, #111, #124 | Open, no milestone (D155 item 7) | Not met |
| #106 | Open, no milestone | Waits for the package that next touches the bundle cache or `verify` |

## Next

WP-30, remote server and remote MCP (`docs/design/work-packages/WP-30.md`), in a fresh session from `docs/design/work-packages/PROMPT.md` with `WORK PACKAGE: WP-30`. It owns RM-03, MC-04, HY-08, HY-09, HO-09, RM-08 and RM-09, RM-02's external check, #129 and #132.
