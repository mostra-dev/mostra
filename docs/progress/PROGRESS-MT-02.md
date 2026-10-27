# MT-02 progress: the open issues, CI's cache gap and Renovate's updates

**Status:** Candidate, for Mirza's review. A maintenance unit between WP-W3 and WP-13, approved by Mirza on 2026-10-26 (M42, D154). It owns no requirement of its own; the checks it adds extend their owners' rows. Its scope is the GitHub milestone `MT-02`: the flake issues #35, #39, #46, #55, #66 and #85, CI's cache gap #86, the first install's time on Windows arm64 #88, and Renovate's open updates #80 to #84. Done when the milestone is empty and a full CI run (`ci:full`, every leg) and the merge queue are green.

## Baseline

| | |
|---|---|
| Branch | `mt/02-issues`, created from `origin/main` |
| Starting `HEAD` | `484a9e9` (`origin/main`, 2026-10-27: "docs: WP-W3's closeout, D154 and MT-02, Mostra 0.6.0 (#89)") |
| `git status` | clean |
| `pnpm check` | 23 min 38 s on macOS arm64, on a clean checkout of `484a9e9`. Green: format-lint, types, unit, hygiene, e2e, build, boundaries, api, licenses, rust, conformance, docs and commits. One failure: `integration`, `dev.test.ts` "takes an editor's save that moves the old file aside…" ("Timed out waiting for a sync in the gap"), a 900 ms wait the loaded machine missed (fixed here, under #35) |
| Predecessors | WP-W3 done ([PROGRESS-WP-W3](PROGRESS-WP-W3.md) on `origin/main`); no `RECOVERY-MT-02-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, macOS 26.2 arm64. Windows behavior is observed only on GitHub's runners |
| Disk | Freed from 2.9 GB to 17 GB at the start, at Mirza's request: old release smokes in `/tmp` (WP-W1 to WP-W3), 1,476 test homes, earlier Mostra scratch, the Cargo `target/`, Playwright revisions no longer pinned, the bundle cache and the pnpm store's unreferenced packages |

## Issues

| Issue | State | What was found and done |
|---|---|---|
| #35 | Fixed | **Root cause:** a connection closed during `dev/start` removed the session's directory while its dev server child was still writing into it; the removal could fail (`ENOTEMPTY`), and its unawaited rejection ended the supervisor as an uncaught exception ("instance.stopped", "uncaught exception" in the supervisor log of CI run 40359322851), after which every later test found no socket. A session now cleans up after its own start, once the child has stopped; a stop that fails is logged (`dev.stop_failed`), and the supervisor logs an uncaught exception's stack in `instance.stopping` (`MOSTRA_HOST_INTERNAL_ERROR`). `test/unit/dev-session.test.ts` is red on `main`'s dev module and green on the fix; two VR-08 seeds. The baseline's other dev failure (a 900 ms wait for a mirrored file, under the 1.5 s grace) waits as long as a loaded machine needs |
| #86 | Fixed, not yet seen live | **Root cause:** caches are saved only by `main`'s runs, and Blacksmith's cache actions write to Blacksmith's own store, so the fallback to GitHub's runners found GitHub's store cold (VERIFIED_FACTS, MT-02). A `main` run that saves caches on Blacksmith now also runs each Linux leg on GitHub's runners (`linux-github`), and the nightly runs again within 6 days even on an unchanged commit, inside both stores' 7-day eviction. `tools/test/ci.test.ts`; two EN-07 seeds. 275 caches of closed pull requests (about 3.8 GB) were removed from GitHub's store |
| #55 | Diagnosable | No occurrence kept anything: a job GitHub cancels for its own limit runs no failure step. `pnpm check --deadline` (10 minutes for the POSIX integration legs, 14 on Windows, each inside a step limit inside the job's) prints every process, keeps the supervisor logs the test homes still hold, stops the run and fails, so the next occurrence keeps its evidence. A workflow test and three EN-07 seeds hold the limits' order. The cause itself is still open |
| #66 | Partly fixed | The failed-handshake test continued every later session read through Playwright's interception, and in Firefox on Windows a continued read hung until the page gave it up (trace of CI run 40257246209; the same `ready` timeout in 40119528647 and 40112700618). The handler now removes itself after its two refusals. Green 15 of 15 in each engine locally; the old test also passed 25 of 25 in Firefox on `windows-latest` (probe run 40468379315), so the fix has no red run yet. A page that never got ready also failed verify's progress test on Windows arm64 (`MOSTRA_RUNTIME_NOT_READY`, run 40484048564): the test now fails on the verdict with its codes. Ephemeral ports were ruled out for `ERR_NO_BUFFER_SPACE` in a normal run (at most 315 of 16,384 in use, probe run 40484439023). Chromium's `ERR_NO_BUFFER_SPACE`, emulated Firefox and Vitest's worker crash stay open |
| #46, #85 | Diagnosable | Both are a WebKit `fill` whose text never reached the input (#85's trace: the `name` field POSTed empty after `fill("Ana")`, and the shell's blocker refused the Submit, correctly: Mostra lost nothing). Not reproduced: 50 of 50 locally, 3,600 fills in a standalone cross-origin reproduction, 120 of 120 on `ubuntu-latest` (probe run 40468379315). Both tests now record, in the shell's and the frame's documents, every focus change and input event with whether that document had the focus, and fail at the field with the record (`watchTyping`), so the next occurrence says whether the frame lost the focus or the input never came |
| #39 | Diagnosable | Two different failures: a closing tab's edit that never reached the gateway (Firefox, Windows), and a navigation that never committed after the daemon's restart (WebKit, Linux). A failed e2e leg now keeps each daemon's supervisor log and ledger (`e2e-homes-*`), whose `draft.changed` events say when, or whether, a save reached Mostra; an EN-07 seed |
| #88 | Fixed | Timing the SDK's own install steps on every runner (probe run 40473206566) put nearly all of a first install in extraction: 364 to 455 s on Windows arm64, Defender excluded or not. node-tar's `x` writes one entry at a time on Windows and checks what each path already holds. The SDK now writes each file itself into its new, empty directory with its own refusals; the whole install of 0.6.0's real bundle took 88 to 94 s on Windows arm64 instead of 398 to 495, 43 to 45 on x64 instead of 171 (probe run 40482165325). `test/unit/extract.test.ts` builds hostile archives byte by byte; three RT-01 seeds. Not measured: the Rust crate's extractor, which already writes each entry itself |
| #80 to #84 | Landed on the branch | The npm group with lefthook held at the attested 2.2.1 (pnpm refused 2.2.2's trust downgrade); the Actions, each SHA checked against its tag; Node.js 24.22.1 for development and the bundle, pinned from its signed `SHASUMS256.txt` by `tools/release/node-pins.ts`; Renovate no longer pins `engines`, peer ranges or published crates. Two tests named React 19.3.0 and now read the warm set's version; dependencies' agent skills (pnpm 12.11 and later) are denied |
| (new) | Fixed | Node.js 24.22.1 made four runtime unit files fail on `windows-latest`: their tests left ledgers open, and the `afterAll` that removes their directories passed its 10 s, since 24.22.1's `rmSync` retries a held file with backoff where 24.12.0 gave up at once (2.1 s against 0 ms, probe run 40474461066). Varying each change alone: 4 of 4 red on 24.22.1, 4 of 4 green on 24.12.0, with Vitest 5.0.3 and 5.0.5 alike (runs 40473094751, 40473782508). Test support closes registered ledgers before removing, and a directory it can't remove now fails the hook with its path |

## What was built

- **#35** `packages/runtime/src/dev/index.ts`: a session that loses its connection while it starts is cleaned up by its own start, after the child stops; `bin.ts` and `instance/index.ts` log an uncaught exception's stack. Changeset `dev-start-abandoned`.
- **#86** `tools/check/matrix.ts`, `tools/check/ci.ts`, `.github/workflows/ci.yml`: the Linux legs' GitHub twins on cache-saving `main` runs, and the nightly within 6 days.
- **#55, #39** `tools/check/deadline.ts` and `pnpm check --deadline`; the step and job limits; the e2e harness's kept logs and ledgers (`tests/e2e/support/mostra.ts`, `e2e-homes-*`).
- **#88** `packages/sdk/src/bundle/extract.ts`: the parser and synchronous writes. Changeset `bundle-extract-fast`.
- **#66, #46, #85** the failed-handshake test's interception; `watchTyping` in the e2e support; the progress test's verdict check.
- **Node.js 24.22.1** found the unit suites' open ledgers on Windows: `closeBeforeRemoval` in the runtime's test support, and a hook that fails on a directory it can't remove.
- **#80 to #84** the npm group (lefthook at 2.2.1), the Actions, Node.js 24.22.1 (`tools/release/node-pins.ts`, `docs/agents/update-node.md`), Renovate's config; the warm set's React read by the tests that named it; dependencies' agent skills denied. Changesets `deps-october`, `node-24-22-1`.
- **Docs:** D155 (proposed), REPO_STANDARDS §6, `docs/agents/run-ci.md`, `update-dependency.md`, `reproduce-on-linux.md`, `packages/bundle/AGENTS.md`, VERIFIED_FACTS (MT-02).

## Evidence

MT-02 owns no requirement (D154). Its checks extend their owners' rows, which stay with their owners. CI runs, probes and the npm registry are external evidence (GitHub's runners).

| Check | State | How | Result |
|---|---|---|---|
| #35: an abandoned `dev/start` never ends the instance (VR-08, WP-10's row) | verified | `test/unit/dev-session.test.ts`; two VR-08 seeds; `dev.test.ts` on every leg | red on `main`'s dev module, green on the fix; seeds red and green |
| #86: both stores warm (EN-07, WP-01's row) | validated | `tools/test/ci.test.ts`; two EN-07 seeds | twins planned only for cache-saving `main` runs on Blacksmith; the nightly within 6 days; first seen live at the next nightly after the merge |
| #55, #39: hung and failed runs keep their evidence (EN-07) | validated | `pnpm check --job integration --deadline 0.15` with a planted home; one e2e test with `MOSTRA_E2E_LOG_DIR`; workflow tests; four EN-07 seeds | the report, the planted log kept, no Turbo or Vitest left, exit 1; both daemons' logs and ledgers kept with their `draft.changed` times, no keys or secrets |
| #88: a first install (RT-01, WP-11's row) | verified | probe runs 40473206566 (before) and 40482165325 (after), the real 0.6.0 bundle from its release; `extract.test.ts`; three RT-01 seeds; RT-12's link seed | Windows arm64 398 to 495 s, then 88 to 94; x64 171, then 43 to 45; Linux 72, then 15 to 23; macOS 68, then 28 to 33; every file matched `files.json` |
| The Windows unit suites on Node.js 24.22.1 (RT-10, WP-W1's row) | verified | probe runs 40473782508 and 40474461066; CI runs 40467741272 and 40471084130 (red), 40475178117 (green) | 4 of 4 red on 24.22.1, 4 of 4 green on 24.12.0, either Vitest; `rmSync` 2.1 s against 0 ms on a held file; green with the ledgers closed |
| The updates (#80 to #84) | verified | the license audit, size budgets, frozen install, every CI leg | see the full run below |
| A full run (`ci:full`, every leg) | in progress | CI on #90 | run 40484048564: 66 of 69 green; its three failures are fixed in `8f7b5c4` and `f277a2e`; the rerun on `f277a2e` is run 40488322735 |

## Reviews (D80)

- **My review of the diff**, during the work and against the final state: it found the `pnpm check --deadline` tests' blind spot for the e2e job (a job-name pattern without digits) and the `MOSTRA_E2E_LOG_DIR` that Turbo never passed, each fixed with a test red on the old code and a seed.
- **GPT-6.1-Sol** through `codex review --base origin/main` (OpenAI, ChatGPT sign-in, codex-cli 0.162.1), effort high, on 2026-10-27 against `3f83cf7`: 2,942,924 input tokens (2,803,200 cached) and 10,258 output (4,914 reasoning). A GPT-only run, announced first (D34). Four findings, all valid, all fixed with a test red on the old code and a seed red planted and green restored:
  1. (P1) The extractor made a link through another link (`top/lib` linking outside, then `top/lib/planted`), outside the directory; node-tar's `x` had refused it. Every link's directory is now made before any link, so such a link meets a real directory and is refused in either order (`518b3d8`). The same pass also counts names macOS and Windows keep as one file (case, Unicode normalization) as one path.
  2. (P2) A nightly that skipped renewed its commit's cover, so an unchanged commit never ran again; a newer failed nightly didn't stop a skip either. `coveringNightly()` counts only a nightly that ran its gates (`e4f26ad`).
  3. (P2) The deadline looked for test homes only in `tmpdir()`, not in `/tmp`, where the POSIX suites make them (`df31f7c`).
  4. (P2) The deadline's Windows cleanup could end its own PowerShell first (`df31f7c`; a probe on `windows-latest` exercises it).
- **Copilot:** no review (its quota).
- **Claude Opus 5.5** (D144): the prompt is ready for Mirza to run.

## Untested boundaries

- **#86 live:** the twins first run at the nightly after the merge; the plan is tested, not yet a cold fallback after a Blacksmith nightly.
- **The Rust crate's extraction time** on Windows wasn't measured; it already writes each entry itself.
- **#55, #39, #46, #85, #66's remaining parts** didn't recur in this unit's runs; each now keeps what its next occurrence needs.
- **A desktop Windows machine** for #88: the runners only.

## Agent-facing prose (D149), for Mirza's review

`docs/agents/update-node.md` (new), `docs/agents/run-ci.md` (the deadline, the e2e homes, the caches), `docs/agents/update-dependency.md` (trust downgrades), `docs/agents/reproduce-on-linux.md`, `packages/bundle/AGENTS.md`.
