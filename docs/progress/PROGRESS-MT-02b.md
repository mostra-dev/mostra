# MT-02b progress: the Windows connection failures and the protocol's Node.js line

**Status:** Done. Accepted by Mirza on 2026-10-28 (M46: "absolutely incredible! … I 100% accept and approve, we can merge, release, close out and finalize MT-02b") with D157 and its agent-facing prose, after two GPT-6.1-Sol reviews and their fixes; merged to `main` through the merge queue as `1a49630` (#94) and released as Mostra 0.6.2. A second maintenance unit between WP-W3 and WP-13, approved on 2026-10-27 (M44, D156), continuing MT-02 in the same session. It owns no requirement of its own; the checks it adds extend their owners' rows. Its scope was the milestone `MT-02b`: #92, #66 and #39.

## Baseline

| | |
|---|---|
| Branch | `mt/02b-windows-connections`, created from `origin/main` |
| Starting `HEAD` | `0f81e48` (`origin/main`, 2026-10-27: "docs: MT-02's closeout, Mostra 0.6.1, #92 to WP-13 (#93)") |
| `git status` | clean |
| CI on the starting commit | #93's merge-queue run passed every job it ran; #90's (40550711821) passed all 69 jobs on every leg, Windows arm64 and the six-platform rehearsal included |
| `pnpm check` | 67 min on a clean worktree of `0f81e48`, macOS arm64, with load averages of 20 to 40 from other sessions on the machine. Green: format-lint, types, hygiene, build, boundaries, api, licenses, rust, conformance, docs and commits. Failed under the load: unit, integration and e2e, each by timeouts in tests that pass alone (log in the session's scratch). The same commit's CI passed every job on every leg (#93's merge-queue run), which is this unit's real baseline |
| Predecessors | MT-02 done ([PROGRESS-MT-02](PROGRESS-MT-02.md) on `origin/main`), released as Mostra 0.6.1 |
| Local toolchain | Node 24.22.1 for the repository (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64. Windows behavior is observed only on GitHub's runners |

## What is known at the start

- **#66, `ERR_NO_BUFFER_SPACE`:** Chromium on Windows, Windows' `WSAENOBUFS` on connect. In every occurrence with traces, the failed request was Chromium's first connection to a loopback listener bound moments before: the shell's port at a suite's first request (#64), a conformance scenario's fresh shell (run 40270808000), and an artifact port bound at its first frame ticket (D132), 93 ms before the frame's connect (run 40566151991). Later requests to the same port passed. Ephemeral ports were ruled out (at most 315 of 16,384 in use, probe run 40484439023).
- **#66 and #39, unanswered requests:** on Windows Firefox, a request on an established listener got no answer within the test (run 40581349433: a reloaded frame's `GET /` after its `enter` redirect; run 40524581425: the reopened profile's page never sent `mostra/ready`, while Mostra answered everything else). The gateway logs refusals only, so its log can't say whether such a request arrived.
- **#39 on WebKit, Linux:** a navigation after the daemon's restart that never committed (a shell `GET` recorded as `-1`, run 40323009583).
- **#92:** `@mostra/protocol` declares `node >=24`; `@mostra/cli` and `@mostra/sdk` declare `>=22.19` and depend on it. npm on Node.js 22 warns `EBADENGINE` (probe run 40579579678, every runner). 0.6.0 has it too.

## Decisions

- **D156** (M44): MT-02b's scope and bound.
- **D157** (M45): the shell loads a failed frame again, the gateway keeps idle connections for browsers to close, Chromium keeps its randomization in tests and `verify`.

## Issues

| Issue | State | What was found and done |
|---|---|---|
| #92 | Fixed (`e33361f`), closes on merge | `@mostra/protocol` declares Node.js `>=22.19`, like the CLI, the SDK, `create-mostra` and the conformance kit that depend on it; its 244 tests pass on Node.js 22.19.0, and the built SDK and protocol import there (undici 8.12, which the SDK needs, declares `>=22.19.0`, so 22.19 is the floor). Repository lint (`tools/repo-lint/engines.ts`) walks each published package's installed runtime closure (dependencies, installed optional and peer dependencies, never dev ones) and requires every Node.js range in it to admit every version the package's own range admits (`semver.subset`); before the fix it named exactly the four dependents. Two RT-01 seeds red, then green. `docs/agents/update-dependency.md` says to check a dependency's Node.js line |
| #66 | Fixed (D157), closes on merge; its unexplained parts are #95 | **Cause** (probe runs 40604043572, 40604922262, 40605653405, 40606620661; VERIFIED_FACTS, MT-02b): from Windows 11 22H2 on, Chromium picks each connection's local port at random (`SO_RANDOMIZE_PORT`, its default-on `TcpPortRandomizationWin`), and a port that collides with a connection the listener closed and keeps in TIME_WAIT fails at once. 32 in 500,000 connections from Chromium as it ships; 0 in 500,000 with the randomization off, 0 from Node.js and Firefox, 0 on Linux and macOS. A failed connection never reaches the gateway. A listener's freshness wasn't the cause: failures land on new connections, and new connections mostly come with new listeners. **Fixes** (M45, D157): the gateway keeps idle connections 305 s, longer than Chromium (300 s) and Firefox (115 s), so browsers close them and the gateway keeps none in TIME_WAIT (`c6f49b9`); the shell enters a frame again when it never greets (`4e81b4c`); `verify` counts only the failed requests of the frame the page ends in; Chromium keeps its randomization everywhere. **Still open:** Firefox's requests left unanswered on established connections (run 40581349433, the reopened profile of run 40524581425). The e2e daemons now record every request's arrival and how it ended (`MOSTRA_TEST_REQUEST_LOG`, `f35ee38`), so the next occurrence shows whether the request reached the gateway. At the closeout (M46) they went to **#95**, on no milestone (D155 item 7), with the two one-offs #94's own runs met: Vitest's browser mode losing its page (Windows x64) and Node.js's `connect ENOBUFS` in the conformance kit (Windows arm64) |
| #39 | Open, back on no milestone (M46) | Its Windows Firefox occurrences are #66's unanswered requests, now recorded as above; the shell's recovery also replaces a reopened frame that never greets |

## Evidence

MT-02b owns no requirement (D156). Its checks extend their owners' rows, named in each line. CI runs are on GitHub's runners (external); the probes ran on a never-merged branch.

| Check | State | How | Result |
|---|---|---|---|
| #66's cause: Chromium's random ports on Windows | verified (external) | Probe runs 40604043572, 40604922262, 40605653405, 40606620661 | 32 `ERR_NO_BUFFER_SPACE` in 500,000 connections as Chromium ships, 0 in 500,000 with `TcpPortRandomizationWin` off on the same runners; 0 from Node.js and Firefox; 0 on Linux and macOS (VERIFIED_FACTS, MT-02b) |
| The gateway keeps idle connections for browsers to close (SH-03, WP-05's row) | validated | `test/unit/listener-keepalive.test.ts` through a real listener and a raw socket; an SH-03 seed restoring Node's default | Open past Node's 6 s, a second request answered on the same connection, `Keep-Alive: timeout=305`; seed red, then green. The gateway's unit and hygiene suites green |
| The shell loads a failed frame again (SH-03) | validated | `tests/e2e/specs/client.spec.ts`, "a frame whose load fails": the frame's first `enter` refused; every `enter` refused; the frame greeting while its new ticket is on its way; every new ticket unanswered. Chromium, Firefox and WebKit | All four green in the three engines, locally and on every CI leg; the SH-03 seeds (no recovery, a late ticket used, a ticket request without a deadline) red, then green |
| `verify` counts only the frame the page ends in (AX-02, WP-09's row) | validated | `packages/verify/test/network.test.ts` through `watchNetwork`; an AX-02 seed | A replaced frame's `ERR_NO_BUFFER_SPACE` isn't a finding, the final frame's failure is; seed red, then green |
| #92: the Node.js lines of published packages (RT-01, WP-11's row) | verified | Repository lint before and after the fix; the protocol's tests on Node.js 22.19.0; two RT-01 seeds | Before: exactly the CLI, conformance, `create-mostra` and the SDK named; after: green over 17 manifests; 244 protocol tests pass on 22.19.0; seeds red, then green |
| The request record keeps no secrets (EN-07, WP-01's row) | validated | `test/unit/listener-trace.test.ts`; an EN-07 seed logging the query | A ticket in the query never reaches the log; an unanswered request is logged as one; seed red, then green |
| Everything, every leg | verified (external) | `ci:full` on #94 | Run 40691287368 on `e3c1fb0`: 69 jobs green at the first attempt. Run 40699922519 on `58082bc` (after the first GPT review's fixes): 68 of 69 green, `unit (windows-x64)` lost its browser in Vitest's own browser mode (`@mostra/react`, untouched here; #95) and passed when re-run (attempt 2). Run 40714401277 on `e7aa1d3` (after the second review's fixes): 68 of 69 green, `integration (windows-arm64, windows-clients)` met Node.js's `connect ENOBUFS` in the conformance kit (#95) and passed when re-run (attempt 2) |

## Reviews (D80)

- **My review of the diff**, during the work and against the final state: the shell's recovery replaces only a frame that never greeted (its page ran no client runtime, so nothing typed is lost), and `verify` records console errors inside the artifact's page only, so a replaced frame's error page adds nothing to a verdict.
- **GPT-6.1-Sol** through `codex review --base origin/main` (OpenAI, ChatGPT sign-in, codex-cli 0.162.1), effort high, on 2026-10-28 against `faa2b1d`: 1,511,890 input tokens (1,414,784 cached) and 7,643 output (3,074 reasoning). A GPT-only run, announced first (D34). Two findings, both valid, both fixed in `dcecfb3` with an e2e test red on the old code and green in three engines, and an SH-03 seed red planted and green restored:
  1. (P2) A ticket asked for while the frame hadn't greeted replaced it even when it greeted meanwhile, so a page that worked could lose what was typed in it. The wait now aborts its request and ignores its answer once it ends. Red on the old code: the frame's view changed (`vw_…74DS…` to `vw_…7MHW…`).
  2. (P2) A ticket request that never answered stalled the recovery before its bound. Each request has 10 s, then counts as a failed attempt. Red on the old code: stuck at `data-frame-reloads="1"`.
- **GPT-6.1-Sol again**, in place of the Claude Opus review (Mirza's choice at M46): `codex exec` (codex-cli 0.162.1, read-only sandbox, effort high) with the prompt written for Opus (the package, its decisions, where to look hardest), on 2026-10-28 against `d9c1767`: 3,636,762 input tokens (3,498,624 cached) and 21,037 output (10,429 reasoning). Five findings, all valid, all fixed with a test red on the old code and a seed red planted and green restored:
  1. (P2) A late re-entry ticket (D115) could replace the frame the recovery had just loaded.
  2. (P2) The greeting reached the recovery only after React committed, so a ticket answered in between still replaced a frame that greeted.

     Fix for 1 and 2: every entry of the frame and every greeting go through one owner, `packages/shell/src/entries.ts`, which drops a ticket asked for before the frame greeted or before a later entry; the bridge reports the greeting at once (`test/entries.test.ts`).
  3. (P2) `call()` resolved `undefined` when an answer's body was cut off, so an aborted ticket reached `setTicket`; it now fails as the request did (`test/api.test.ts`).
  4. (P2) `verify`'s 15 s ready wait ended before the shell's recovery could finish: each frame entry now gets its own 15 s, and the wait ends when the shell gives up (`awaitReady`, `packages/verify/test/ready.test.ts`); in `verify` the shell loads a failed frame again once, so a page that never greets is reported about as soon as before.
  5. (P2) A version switch inherited a used-up recovery budget; a switch the viewer chooses gets the whole budget again (e2e "gets its whole budget again when the viewer switches", three engines).
- **Claude Opus 5.5**: not run; Mirza chose the second GPT review in its place (M46).
- **Copilot**: no review (its quota).

## Agent-facing prose (D149)

Accepted by Mirza with the unit (M46), in one batch:
- the viewer-facing line "This page didn't load. Reload this page to try again." (`packages/shell/src/words.ts`);
- `packages/shell/AGENTS.md` (the frame's recovery and `src/entries.ts`);
- `packages/runtime/AGENTS.md` (the test-only `MOSTRA_TEST_REQUEST_LOG`);
- `docs/agents/update-dependency.md` (a dependency's Node.js line).

## Untested boundaries

- **A Windows desktop with Chrome or Edge.** The cause and the fixes were observed only on GitHub's Windows Server 2025 x64 and Windows 11 arm64 runners. The shell's recovery is proven by refusing the frame's load on purpose, in Chromium, Firefox and WebKit, not by Chromium's own collision.
- **Whether the gateway's 305 s keep-alive ends the collisions** rather than only making them rarer: no CI run after it met `ERR_NO_BUFFER_SPACE`, which proves nothing at its rate (about 1 in 15,000 to 30,000 connections). The shell's recovery covers what's left.
- **#95's three parts:** Firefox's unanswered requests, Vitest's lost browser and Node.js's `connect ENOBUFS` were each seen once and never reproduced.

## Deviations

- **The second review was GPT-6.1-Sol, not Claude Opus 5.5** (D144), by Mirza's choice at M46. It ran as `codex exec` with the prompt written for Opus, since `codex review --base` takes no instructions.
- **#66 closed by hand:** #94's description put both issues in one "Closes" phrase, which GitHub reads for the first issue only, so #66 was closed with a comment after the merge.
- **The version pull request's local check:** format-lint, types, boundaries, api, licenses and docs ran locally. The whole `pnpm check --affected` didn't, since on this machine's load it takes about 45 minutes and times out, as at 0.6.1 (#91). The merge queue rehearsed all six platforms.
- **Temporary probe branch** `probe/mt02b-connect` (never merged) established #66's cause; its runs are cited in VERIFIED_FACTS, and it was deleted once measured.

## Issues

| Issue | Disposition |
|---|---|
| #92 | Fixed; closed by the merge |
| #66 | Fixed (D157); closed with the merge, by hand |
| #95 (new) | #66's unexplained parts, on no milestone (D155 item 7, M46) |
| #39 | Open, on no milestone again (M46) |
| #46, #55, #85 | Unchanged, on no milestone (D155 item 7) |

## Commits and publication

- **Range:** `0f81e48..5917cf1` on `main`: the signed-off commits of `mt/02b-windows-connections` and the merge commit of [#94](https://github.com/mostra-dev/mostra/pull/94) (`1a49630`), then the version pull request [#96](https://github.com/mostra-dev/mostra/pull/96) (`5917cf1`).
- **Released, Mostra 0.6.2** (D36, `docs/agents/release.md`): [release run 40745231452](https://github.com/mostra-dev/mostra/actions/runs/40745231452), 20 jobs green. It published the immutable GitHub release [`v0.6.2`](https://github.com/mostra-dev/mostra/releases/tag/v0.6.2) with its 13 assets, the npm packages at 0.6.2 with provenance, and `mostra-host` 0.6.2 on crates.io.
- **External checks, 2026-10-28:**
  - `gh attestation verify mostra-0.6.2-win32-x64.tar.gz` passes (SLSA provenance v1), and the darwin-arm64 and win32-x64 archives match `SHA256SUMS`.
  - `npm view` shows 0.6.2 with SLSA provenance for `@mostra/cli`, `runtime`, `sdk`, `protocol`, `conformance`, `react`, `shell`, `verify`, `worker`, `server` and `create-mostra`. `@mostra/protocol@0.6.2` declares `>=22.19`. crates.io's latest `mostra-host` is 0.6.2.
  - On this Mac on **Node.js 22.19.0**, with empty home, cache, config and npm cache directories, `npm create mostra@0.6.2 my-artifact` installed the pinned bundle and scaffolded the artifact in 118 s with no `EBADENGINE` warning (#92). `verify` returned `pass`, `publish` made `ver_HS8DTDRARSJBFKTKP3P4A9NMCY`, and `doctor` reported every check `ok`.
- **Remaining dirty paths:** none in the repository. Outside it: scratch scripts, probe workflows, CI logs, traces, review texts and the external smoke in `~/.jcode/scratch/mt02`, and test homes under the system's temporary directory.

## Next

WP-13, sharing and remote viewing (`docs/design/work-packages/WP-13.md`), in a fresh session from `docs/design/work-packages/PROMPT.md` with `WORK PACKAGE: WP-13`. Its milestone is empty, and #46, #55, #85, #39 and #95 are on no milestone (D155 item 7).
