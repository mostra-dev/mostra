# MT-02b progress: the Windows connection failures and the protocol's Node.js line

**Status:** In progress. A second maintenance unit between WP-W3 and WP-13, approved by Mirza on 2026-10-27 (M44, D156), continuing MT-02 in the same session. It owns no requirement of its own; the checks it adds extend their owners' rows. Its scope is the GitHub milestone `MT-02b`: #92 (`@mostra/protocol` declares a newer Node.js than the CLI and SDK that depend on it), #66 whole (Windows browser failures: Chromium's `ERR_NO_BUFFER_SPACE`, requests left unanswered, the emulated Firefox closing a page, Vitest's worker crashes) and #39 whole (the tab-close and reopen path, whose occurrences share #66's shape). #46, #85 and #55 stay unassigned (D155 item 7). Done when D156 item 4 holds.

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
| #66 | `ERR_NO_BUFFER_SPACE` found and fixed (D157); the unanswered Firefox requests open | **Cause** (probe runs 40604043572, 40604922262, 40605653405, 40606620661; VERIFIED_FACTS, MT-02b): from Windows 11 22H2 on, Chromium picks each connection's local port at random (`SO_RANDOMIZE_PORT`, its default-on `TcpPortRandomizationWin`), and a port that collides with a connection the listener closed and keeps in TIME_WAIT fails at once. 32 in 500,000 connections from Chromium as it ships; 0 in 500,000 with the randomization off, 0 from Node.js and Firefox, 0 on Linux and macOS. A failed connection never reaches the gateway. A listener's freshness wasn't the cause: failures land on new connections, and new connections mostly come with new listeners. **Fixes** (M45, D157): the gateway keeps idle connections 305 s, longer than Chromium (300 s) and Firefox (115 s), so browsers close them and the gateway keeps none in TIME_WAIT (`c6f49b9`); the shell enters a frame again when it never greets (`4e81b4c`); `verify` counts only the failed requests of the frame the page ends in; Chromium keeps its randomization everywhere. **Still open:** Firefox's requests left unanswered on established connections (run 40581349433, the reopened profile of run 40524581425). The e2e daemons now record every request's arrival and how it ended (`MOSTRA_TEST_REQUEST_LOG`, `f35ee38`), so the next occurrence shows whether the request reached the gateway |
| #39 | Open | Its Windows Firefox occurrences are #66's unanswered requests, now recorded as above; the shell's recovery also replaces a reopened frame that never greets |

## Reviews (D80)

- **My review of the diff**, during the work and against the final state: the shell's recovery replaces only a frame that never greeted (its page ran no client runtime, so nothing typed is lost), and `verify` records console errors inside the artifact's page only, so a replaced frame's error page adds nothing to a verdict.
- **GPT-6.1-Sol** through `codex review --base origin/main` (OpenAI, ChatGPT sign-in, codex-cli 0.162.1), effort high, on 2026-10-28 against `faa2b1d`: 1,511,890 input tokens (1,414,784 cached) and 7,643 output (3,074 reasoning). A GPT-only run, announced first (D34). Two findings, both valid, both fixed in `dcecfb3` with an e2e test red on the old code and green in three engines, and an SH-03 seed red planted and green restored:
  1. (P2) A ticket asked for while the frame hadn't greeted replaced it even when it greeted meanwhile, so a page that worked could lose what was typed in it. The wait now aborts its request and ignores its answer once it ends. Red on the old code: the frame's view changed (`vw_…74DS…` to `vw_…7MHW…`).
  2. (P2) A ticket request that never answered stalled the recovery before its bound. Each request has 10 s, then counts as a failed attempt. Red on the old code: stuck at `data-frame-reloads="1"`.
- **Copilot**: no review (its quota).
