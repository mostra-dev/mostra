# MT-02b progress: the Windows connection failures and the protocol's Node.js line

**Status:** In progress. A second maintenance unit between WP-W3 and WP-13, approved by Mirza on 2026-10-27 (M44, D156), continuing MT-02 in the same session. It owns no requirement of its own; the checks it adds extend their owners' rows. Its scope is the GitHub milestone `MT-02b`: #92 (`@mostra/protocol` declares a newer Node.js than the CLI and SDK that depend on it), #66 whole (Windows browser failures: Chromium's `ERR_NO_BUFFER_SPACE`, requests left unanswered, the emulated Firefox closing a page, Vitest's worker crashes) and #39 whole (the tab-close and reopen path, whose occurrences share #66's shape). #46, #85 and #55 stay unassigned (D155 item 7). Done when D156 item 4 holds.

## Baseline

| | |
|---|---|
| Branch | `mt/02b-windows-connections`, created from `origin/main` |
| Starting `HEAD` | `0f81e48` (`origin/main`, 2026-10-27: "docs: MT-02's closeout, Mostra 0.6.1, #92 to WP-13 (#93)") |
| `git status` | clean |
| CI on the starting commit | #93's merge-queue run passed every job it ran; #90's (40550711821) passed all 69 jobs on every leg, Windows arm64 and the six-platform rehearsal included |
| `pnpm check` | running on a clean worktree of `0f81e48` |
| Predecessors | MT-02 done ([PROGRESS-MT-02](PROGRESS-MT-02.md) on `origin/main`), released as Mostra 0.6.1 |
| Local toolchain | Node 24.22.1 for the repository (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64. Windows behavior is observed only on GitHub's runners |

## What is known at the start

- **#66, `ERR_NO_BUFFER_SPACE`:** Chromium on Windows, Windows' `WSAENOBUFS` on connect. In every occurrence with traces, the failed request was Chromium's first connection to a loopback listener bound moments before: the shell's port at a suite's first request (#64), a conformance scenario's fresh shell (run 40270808000), and an artifact port bound at its first frame ticket (D132), 93 ms before the frame's connect (run 40566151991). Later requests to the same port passed. Ephemeral ports were ruled out (at most 315 of 16,384 in use, probe run 40484439023).
- **#66 and #39, unanswered requests:** on Windows Firefox, a request on an established listener got no answer within the test (run 40581349433: a reloaded frame's `GET /` after its `enter` redirect; run 40524581425: the reopened profile's page never sent `mostra/ready`, while Mostra answered everything else). The gateway logs refusals only, so its log can't say whether such a request arrived.
- **#39 on WebKit, Linux:** a navigation after the daemon's restart that never committed (a shell `GET` recorded as `-1`, run 40323009583).
- **#92:** `@mostra/protocol` declares `node >=24`; `@mostra/cli` and `@mostra/sdk` declare `>=22.19` and depend on it. npm on Node.js 22 warns `EBADENGINE` (probe run 40579579678, every runner). 0.6.0 has it too.

## Issues

| Issue | State | What was found and done |
|---|---|---|
| #92 | Open | |
| #66 | Open | |
| #39 | Open | |
