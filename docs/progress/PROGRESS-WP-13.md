# WP-13 progress: sharing and remote viewing

**Status:** In progress. Owns HY-04, HY-05, HY-07 and HO-10 ([specification](../design/work-packages/WP-13.md)).

## Baseline

| | |
|---|---|
| Branch | `wp/13-sharing`, fast-forwarded to `origin/main` (a stale local branch of that name pointed at `814859a`, with no commits of its own) |
| Starting `HEAD` | `a9758a4` (`origin/main`, 2026-10-28: "docs: MT-02b's closeout, Mostra 0.6.2, WP-13 next (#97)") |
| `git status` | clean |
| CI on the starting commit | the nightly of 2026-10-28 (run 40667329008) passed; MT-02b's `ci:full` run 40714401277 passed every leg on its last attempt (PROGRESS-MT-02b); #97's merge-queue run 40753624394 met #98 (below) |
| `pnpm check` | 38 min on a clean worktree of `a9758a4` (macOS arm64, the machine loaded by this session's own builds and a real-tunnel smoke). Green: types, hygiene, build, boundaries, api, licenses, rust, conformance, docs, commits. Failed under the load, each by timeouts in tests that pass alone and on CI (as in MT-02b's baseline): unit (`gc.test.ts` VR-06 at 30 s; `@mostra/tools` `gates.test.ts` at 180 s), integration (`verify.test.ts` "passes a plain React page", `verify-failures.test.ts` timeout case), e2e (saves left `offline`/`saving` while the machine was loaded). format-lint: ESLint exited 2 in the fresh worktree (its `tools/ts6` install), not a finding in the code. The same commit's nightly CI (run 40667329008) passed every job, which is the real baseline |
| Predecessors | WP-W3 done ([PROGRESS-WP-W3](PROGRESS-WP-W3.md) on `origin/main`); MT-02 and MT-02b done, released as Mostra 0.6.2 |
| Milestone `WP-13` | #98 (a telemetry lock race in `@mostra/cli`, seen on Windows arm64 in #97's merge-queue run) |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64; `cloudflared` 2026.10.3 at `/opt/homebrew/bin/cloudflared`; Tailscale 1.102.3, Homebrew's formula left unlinked (`/opt/homebrew/opt/tailscale/bin/tailscale`), which a first look took for missing |

## Decisions

- **M47** (2026-10-28): the whole package without narrowing it, whatever the time; the static export's AU-09 check moved to WP-24, which builds that exporter; WP-13's design choices delegated (`<ITU/>`); tailnet settings changed where the session can.
- **D158**: WP-13's sharing design, recorded under M47: faces (each external address its own loopback listener, told apart by socket, never by `Host`), tailnet identity only on a tailnet face from a loopback peer and never beside Funnel's mark, a link's own viewer for every other tunnel visitor, `share/start|stop|list` and their lifetimes, foreground tunnel children, Cloudflare's worker-mode frames and stream tickets, the `addressing` port's shape (`{ artifactId, listener, local }` → `{ origin, mode? } | null`, kept and leased so links survive restarts, withdrawn by `null` or another origin), and item 8, what building and the real tailnet found.

## Evidence

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| HY-04 | verified | External: a real Tailscale Serve share opened from a Galaxy S24+ in the tailnet; the session's viewer is the tailnet person; spoofed identity headers never count: from a non-loopback peer, beside Funnel's `Tailscale-Funnel-Request`, on a Funnel or Cloudflare face, or past the tunnel; faces bind loopback whatever `--bind` says | `mostra share <artifact> --tailnet` on this Mac (tailnet `tail7dd0a7.ts.net`), the phone, `mostra results`; `vitest run test/integration/share.test.ts test/unit/sharing.test.ts`; `prove-seeds.ts --only HY-04` | The phone saved, ran an action on the Mac and submitted; `results` shows viewer `{ kind: "tailnet", ref: "mmirzabicer@gmail.com", name: "Mirza Biçer" }` (RFC 2047 decoded). Share suite 19/19, unit 8/8; both HY-04 seeds red planted, green restored. External, 2026-10-29 |
| HY-05 | verified | External: a Funnel share (shell 443, artifact 8443) and a Cloudflare quick-tunnel share in worker mode, each behind `--public` with a short-lived link (1 h default, 7 d at most), opened from the phone over mobile data; long polls where the tunnel holds streams back; stop, expiry, revocation and a dead tunnel end a share | `mostra share <artifact> --public [--via funnel] --ttl 2h`, the phone, `mostra results`, `mostra share stop`, `curl`; `share.test.ts`; `prove-seeds.ts --only HY-05` | Both shares saved, ran the action and submitted, each as its link's own viewer (`link:<tokenId>`, "Shared link"); the Cloudflare page long-polled with stream tickets (no event stream opened over the quick tunnel); after `share stop` the Cloudflare address answered 530, the Funnel and Serve ones refused connections, and no tunnel process or Serve configuration remained. Within minutes of Funnel going public, scanners probed `/.env`, `/.git/config` and the like: every one refused (404 or 401). Share suite 19/19; four HY-05 seeds red, green. External, 2026-10-29 |
| HY-07 | verified | Worker-mode cross-site fixture (shell on `localhost`, artifact on `127.0.0.1`, two sites) in Chromium, Firefox and WebKit, reload included; real Safari 26.2 in worker mode and reload; an artifact's own service worker refused with `MOSTRA_HYGIENE_FRAME_SESSION`; ticketed streams; a socket ticket of the wrong purpose or used twice refused | `playwright test specs/worker-mode.spec.ts`; `node packages/runtime/scripts/safari-smoke.ts --worker`; `vitest run --project hygiene`; `prove-seeds.ts --only HY-07`; `ci:full` runs 40878667196 (`542aca6`) and 40883247467 (`2f7265f`) | e2e 4/4 per engine (Chromium and WebKit every local run; Firefox green on every CI leg, locally flaky only at load averages above 20, as the cookie-mode control test was); Safari: all 11 facts in worker mode (`worker-controlled`, `reload-*`) and all 11 in cookie mode; hygiene 38/38; seeds red, green; both full CI runs 69/69 jobs on every leg |
| HO-10 | verified | Conformance: a host's external base appears in minted links and passes the Host and Origin checks; without the port, links stay on loopback; a base the host withdraws stops working | `mostra-conformance --only ports.addressing` against the TypeScript reference host (scripted, `--standalone`, `--unscripted`) and the Rust reference host; `worker-mode.spec.ts` "stops working at a base the host withdraws"; `prove-seeds.ts --only HO-10` | Passes on both hosts in every mode; the withdrawn base refuses its next exchange (410), then its address is served nowhere, and links are minted on loopback again; three HO-10 seeds red, green (the third found that a withdrawal closed its listener under the exchange that learned of it, fixed in `5adb117`) |

## Issues

| Issue | State | What was found and done |
|---|---|---|
| #98 | Fixed (`1a29400`), closes on merge | A stale-lock breaker moved a lock aside and linked it back when it wasn't the one it judged; an owner that released in between left a lock nobody owned. The breaker now acts only under its own break lock (`telemetry.lock.break`, exclusive create with a token), judges the lock again there and removes only a lock still stale, never bringing one back. A two-process test widens the window (`MOSTRA_TEST_LOCK_BREAK_MS`) and fails on the old code; an EN-08 seed red, green |

## Reviews (D80)

- **My review of the diff**, during the work and against each slice: the route runner, sessions and tickets (`routes.ts`, `capabilities.ts`), the faces and the external bases (`gateway/index.ts`), the share lifecycle (`share/index.ts`). It found the withdrawn base that closed its listener under the exchange that learned of it (`5adb117`, HO-10's third seed) and, beside the GPT review's third finding, that rotating a share's link ended the share (fixed below).
- **GPT-6.1-Sol** through `codex review --base origin/main` (OpenAI, ChatGPT sign-in, codex-cli 0.162.1), effort high, on 2026-10-29 against `4b7537b`: 4,375,395 input tokens (4,213,888 cached) and 14,229 output (6,594 reasoning). A GPT-only run, announced first (D34). Five findings, all P2, all valid, each fixed with a test red on the old code and a seed red planted and green restored:
  1. A Funnel share's faces weren't leased, so after a restart they listened on other local ports, their session cookies (named by the port) no longer matched, and an open page got 401. Funnel faces are leased now ("keeps a Funnel share's sessions across a restart").
  2. A stopped artifact's Funnel port stayed assigned to its face, so sharing it again asked for the port another artifact had taken. Releasing a face frees its port, and a port is chosen only when no other face holds it ("gives a stopped artifact's Funnel port to the next one").
  3. `view/rotate` minted the replacement of a link at a host's external base on loopback. A rotated link stays at its address while the gateway serves it; a loopback link whose shell moved still moves to the shell's address (unit test "rotate a link at an address the gateway serves there"). Found beside it: rotating a share's link made the share end at the next sweep, as revoked. A share follows its link through rotations now (`Capabilities.current`), and only revoking ends it ("follows its link when the link is rotated").
  4. When one of a quick-tunnel share's two tunnels failed while the other still started, the failure released both faces and the other tunnel came up with nothing to stop it. Both outcomes are awaited before either is judged ("leaves no tunnel running when one of a quick tunnel share's two fails").
  5. A share stopped while its Tailscale tunnel was being set up again left the new tunnel running. The restart runs one at a time with starts and stops, and stops what it started when the share is gone ("…while its tunnel is being set up again").

  The tunnel stand-ins gained what these tests need: fixed Funnel ports (`MOSTRA_FAKE_FUNNEL_PORT_BASE`), one of two quick tunnels failing (`MOSTRA_FAKE_CLOUDFLARED=fail-one`), and a tunnel ended on demand and a slow restart (`MOSTRA_FAKE_CONTROL`); the sweep's period is a test variable (`MOSTRA_TEST_SHARE_SWEEP_MS`).
- **Claude Opus 5.5** (D144), run by Mirza on 2026-10-29 from the prompt written for it, against `558fe34`, posted on #100 (Anthropic, run and approved by Mirza, D34): ten findings (2 P1, 5 P2, 3 P3), all valid, all fixed with a test red on the old code and a seed red planted and green restored:
  1. (P1) A host's shell address opened a leased face and asked the host's `addressing` port for any artifact ID in a path, before any capability check, leaking listeners and leases. A face kept for one artifact now serves that artifact only (`artifactOf`), the exchange refuses an artifact the address doesn't serve, and `hostFace` asks only for artifacts of this home (`test/integration/addressing.test.ts`).
  2. (P1) `instance/status` carried every active share's link with its secret, which `mostra inspect` prints. Status now names shares without their links; `share/start` and `share/list` alone give them.
  3. (P2) A share stopped while its restore waited to try again could be set up again after its stop. The share is now judged inside the lifecycle's turn.
  4. (P2) A new share could join a tunnel that was being started again and get a link through nothing. It is refused with `MOSTRA_SHARE_TUNNEL_FAILED` until the tunnel is back.
  5. (P2) Rotating a share's link while its faces were down (after a restart) moved it to loopback. A link at another host's address keeps it; only a loopback link whose port moved moves.
  6. (P2) Of two concurrent questions to a host about one face, the one that failed closed the face the other set up. Questions about one face now go one at a time.
  7. (P2) Stream tickets had no cap, and every use swept every ticket. A session holds at most eight frame tickets and eight stream tickets (the oldest goes), every use checks expiry itself, and sweeps run at most once a second.
  8. (P3) The shell's own event stream was served on a Cloudflare face, where it stalls for 6 s before the shell polls. It is refused there like the frame's.
  9. (P3) Removing a crashed breaker's break lock was check-then-remove, #98's race one level up. Break locks are now numbered: a crashed one is superseded by creating the next number exclusively, never removed by another, and a breaker that finds a higher number than its own holds nothing.
  10. (P3) No test covered a stream ticket's origin, artifact and purpose, or a session's mode. Unit tests and four seeds now do.

  The stand-ins gained `die-<port>`, `refuse-<port>` and `hold` in `MOSTRA_FAKE_CONTROL`, so a test ends, refuses or holds one Tailscale tunnel. Fixed in `4796e6b`; the seeds that a later format changed were anchored again and proved again.
- **Copilot**: no review (its quota).

## Agent-facing prose (D149)

Delegated (M47: "If you're confident with the agent prose, you don't need to present them"): the `share`, `share stop` and `share list` help (`docs/reference/cli.md`); the hints of `MOSTRA_SHARE_*` and `MOSTRA_HYGIENE_FRAME_SESSION` and their pages in `docs/reference/errors/`; the tailnet share's line on the ports and the browser's traffic; the shell's words for a frame session that can't be set up (`FRAME_WORDS.frameSession`); the AGENTS.md of the runtime, React, the shell, the conformance kit, the CLI, the SDK and the crate.

## Untested boundaries

- **Real tunnel tools beyond this Mac.** Tailscale was exercised as Homebrew's formula (1.102.3) on macOS 26.2, and `cloudflared` 2026.10.3 on the same Mac; neither on Linux or Windows, nor the Mac App Store variant of Tailscale. Every CI leg, Windows included, runs the shares on the stand-ins.
- **Viewers' devices.** One Android phone (Galaxy S24+, Chrome) on mobile data and in the tailnet; no iPhone. Real Safari ran on macOS (11 facts in each mode).
- **A real Funnel or tailnet share across a daemon restart**, and a quick tunnel's limits (200 requests in flight, hours of use): the stand-ins only.
- **A browser that blocks service workers in a cross-site frame** (Firefox's private windows, strict third-party storage): proven with Playwright's `serviceWorkers: "block"` in three engines (the shell says so and stops reloading), not in a real private window.
- **WebSockets with tickets**: the gateway's socket route checks a socket ticket (purpose, single use) and then answers 501, since terminals arrive with WP-22 and WP-23; no real socket runs through it yet.
- **A host's real tunnel before an external base**: the conformance kit plays the host's tunnel by naming (`localhost` and `127.0.0.1`).
- **Firefox under heavy load.** The worker-mode reload test failed locally in Firefox at load averages above 20, as the cookie-mode reload test of `client.spec.ts` did; it passed on every CI leg.
- **One poll on the real quick tunnel was refused** (401, a stream ticket already spent: most likely the edge retrying a request); the page polled again with a new ticket and lost nothing.

## Deviations

- **The static export's AU-09 check moved to WP-24** (M47), which builds that exporter.
- **Interfaces past INTERFACES' sketch, additively** (D158): `addressing.externalBase` takes `{ artifactId, listener, local }` instead of `{ artifactId, purpose }`, since a host must know which loopback address to forward; `share/start` takes `scopes`, `viewer` and `requestId` and answers the whole `Share`; `share/list` and `Share.artifactOrigin` are new.
- **A commit's subject**: `558fe34` ("docs: the GPT review of WP-13 …") also carries the review's code fixes, which were staged when it was made; history isn't rewritten (STANDARDS).
