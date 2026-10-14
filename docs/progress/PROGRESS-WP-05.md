# WP-05 progress: gateway, addressing and hygiene

**Status:** Done. Accepted by Mirza on 2026-10-14 ("approved 100%"), merged to `main` as `175a38f`, finalized after the merge (work-packages/README.md §4).

## Baseline

| | |
|---|---|
| Branch | `wp/05-gateway`, created from `origin/main` |
| Starting `HEAD` | `3aa43008925e3c65e2b8f2ee12eea8f62ca96954` (`origin/main` at session start, 2026-10-14: "docs(progress): finalize the WP-04 report (#13)") |
| `git status` | clean |
| `pnpm check` | green: format-lint, types, unit, integration, build, boundaries, api, licenses, rust, docs and commits all pass (2 min 55 s, macOS arm64) |
| Predecessors | WP-02 and WP-03 done ([PROGRESS-WP-02](PROGRESS-WP-02.md), [PROGRESS-WP-03](PROGRESS-WP-03.md) on `origin/main`); WP-04 done too; no `RECOVERY-WP-05-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, macOS 26.2 arm64, Safari 26.2 |
| Pull request | [#14](https://github.com/mostra-dev/mostra/pull/14), merged |

## What was built

- **`@mostra/protocol`:**
  - the methods `view/url`, `view/rotate` and `view/revoke`, with `CapabilityLink`;
  - capability scopes (`view`, `draft`, `submit`, `review`, `action:*`, `action:<export>`, `action:<module path>#<export>`) with `scopeAllows`, and durations;
  - `PublishReceipt.tokenId` and `instance/status`'s `gateway`, both additive;
  - `hygiene`: the pure request checks (exact Host, request target and header sanity, exact Origin by intent, JSON content type, CSRF), which the gateway applies and WP-15's MCP HTTP transport will (D96);
  - `bridge`: JSON-RPC over `postMessage` with exact window and origin checks, schema validation both ways, and the MCP Apps `2026-01-26` names and shapes (`ui/initialize`, `ui/notifications/initialized`, `ui/notifications/size-changed`) plus `mostra/ready`;
  - 15 diagnostic codes with docs pages: 11 HYGIENE, `MOSTRA_ENV_PORT_TAKEN`, `_BIND_FAILED`, `_SHELL_MISSING`, `MOSTRA_ARTIFACT_VERSION_NOT_FOUND`.
- **`@mostra/runtime`:**
  - `addressing` (new): the bind (`--bind`, `--url-host`, D99), canonical origins and exact Host allowlists, port leases from 20000 to 32767 in `port_lease`, re-leasing a taken port with `MOSTRA_ENV_PORT_TAKEN`, the frame-session mode of an origin pair.
  - `gateway` (new):
    - capability tokens whose secrets are HMAC-derived under `<home>/keys/capability` and stored as hashes; one default link per artifact; mint, rotate and revoke with `token.revoked` events; sessions bound to their origin; single-use frame tickets; the guessing limit (D97);
    - one route table in which every route of INTERFACES §4 is declared with its intent, session and scope behind one checking runner; later routes answer 501 behind the same checks (D96);
    - Node HTTP listeners on Hono that check every request's envelope before routing and refuse upgrades, other methods and preflights;
    - static serving of a version's `client/` build only, confined by real path, with ranges and ETags, and no process;
    - the shell's page and assets, the token exchange, frame tickets, frame entry and `/_mostra/session`;
    - framing rules (D98 item 4); integrity of a version checked before its first frame (FAILURE_MODEL §3).
  - Ledger migration 4: `port_lease`, `token` (a trigger refuses any change to a revoked token or to a grant), `session`.
  - `instance` and `mostra-runtime host|daemon` take `--bind` and `--url-host`. The gateway starts before the socket, `PublishReceipt.url` and `tokenId` are set on every publish and replay (D90), and `instance/status` reports the gateway.
  - The builder's client entry reports `mostra/ready` to the shell (`SPA_CONFIG_REVISION` 3).
- **`@mostra/react`:** `connectShell` and `reportReady`, the artifact side of the bridge. It learns the shell's exact origin from `/_mostra/session`.
- **`@mostra/shell`** (new, Vite app, served by the gateway):
  - removes the token from the address bar and exchanges it;
  - gets a frame ticket, hosts the frame and answers the bridge handshake;
  - explains refusals in plain words;
  - runs Zod jitless under its `script-src 'self'` policy.
- **Tests and machinery:**
  - `test/hygiene/checklist.test.ts`, the checklist against a real gateway through a cookie-jar client (`test/browser-client.ts`), as the new `hygiene` job;
  - `test/integration/gateway.test.ts`;
  - `test/unit/gateway.test.ts`;
  - `tests/e2e/specs/gateway.spec.ts` in Chromium, Firefox and WebKit, as the new `e2e` job on macOS and Linux, with traces kept on failure;
  - `scripts/safari-smoke.ts`, the real-Safari run;
  - 22 WP-05 seeds in `prove-seeds.ts`, which now also runs Playwright checks;
  - knip, Turborepo and the e2e playbook updated.

## Decisions taken in the package

M16 and D96 to D99 (recorded on this branch); Mirza delegated all ten questions. Within them:

- **D96, check boundaries.** WP-05 proves URL lifetime, revocation and rotation. The `mostra doctor` warning goes to WP-10, on WP-08's `daemon install`. MCP HTTP hygiene reuses `@mostra/protocol`'s `hygiene` in WP-15. `mostra dev` joins the route enumeration in WP-10. Later packages attach handlers behind the declared routes and repeat the scope tests. Each follow-up is written into its package's specification.
- **D97, capability links.** Fragment tokens, derived secrets, one default link, the scopes, optional TTL, atomic rotation, `viewer` with WP-06, and the guessing limit.
- **D98, cookie-mode sessions.** One cookie per origin, CSRF from `/_mostra/session`, single-use tickets, framing rules, one current version per artifact origin.
- **D99, binding and leases.** Loopback by default; wider binds only by flag, never remembered; leases below the ephemeral ranges, all bound at start.
- **Amendments found by this package's own checks:**
  - D98 item 2: the CSRF token is derived from the cookie and stored as a hash. The hygiene suite found the first version storing a random token in plain text.
  - D97 item 8: cross-site frame entries are refused before they count (the review finding below).
- **Size budgets.** `@mostra/protocol`'s whole entry went from 16 to 24 kB, with a 6 kB bridge budget. `@mostra/react` went from 1 kB to 30 kB including Zod, 7 kB without. Validating bridge messages with the protocol's schemas costs Zod in every version.

## Evidence

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| HY-01 | verified | The 13-point checklist as negative tests against a real gateway, 30 tests: 1 loopback bind; 2 exact Host (rebinding names, ports, case, duplicates); 3 exact Origin on mutations, streams and upgrades; 4 token exchange with the token out of the URL; 5 CSRF and JSON content type; 6 no CORS, preflight refused; 7 CORP and nosniff on every answer; 8 no-referrer and framing; 9 scopes; 10 410 for revoked or expired, rotation, the guessing limit; 11 and 12 no token, cookie, CSRF token or ticket in the logs or the ledger (WAL included); 13 side-effect-free GETs; plus header fuzzing over raw sockets. In three engines: no page elsewhere can frame the shell or an artifact (with an unprotected control that does frame); 40 hidden cross-site frame entries don't lock a viewer out; a revoked link explains itself; a review-only link can't submit. After the Claude review, also: guessing is limited per artifact and checked at the token, so another artifact's page can't lock viewers out (three engines) and 60 concurrent guesses can't slip past it; a full cookie jar set by an artifact's page still opens every link (three engines), and more than 1 MiB of headers gets a page that clears the host's cookies; the frame can't replace the shell, by script, by a `_top` link or through a popup (three engines and real Safari), and `ui/open-link` opens only web, mail and phone URLs in a new tab; a second link asks before it replaces a session; a `requestId` reused with other parameters is refused. MCP HTTP (item 13's transport) is WP-15's (D96) | `pnpm check --job hygiene`; `pnpm check --job e2e`; CI run [38639924724](https://github.com/mostra-dev/mostra/actions/runs/38639924724) (`hygiene`, `e2e` on macOS and Linux); `node packages/runtime/scripts/prove-seeds.ts --only HY-01` | green. Eight seeds, each red, green when restored: any Host accepted, Origin unchecked, CSRF unchecked, CORP dropped, no rate limit, CSRF stored in plain text, any page may frame an artifact, a cross-site frame entry looked at. Fifteen more for the Claude review's fixes (`--only wp05-claude-N`), below |
| HY-02 | verified | By the operating system's socket table (`lsof` on macOS, `ss` on Linux), a default daemon listens only on `127.0.0.1` for the shell and the artifact. `--bind 0.0.0.0` without `--url-host` exits 3 with `MOSTRA_ENV_BIND_FAILED`; with it, every socket is on the wildcard and links name the URL host. The next plain start is loopback again | `pnpm --filter @mostra/runtime test:integration` (`gateway.test.ts` › binding); CI integration on macOS and Linux; `prove-seeds.ts --only HY-02` | green on both platforms; seed (listening on `0.0.0.0` while reporting loopback) red, green when restored |
| HY-03 | verified | A `review`-only link gets 403 `MOSTRA_HYGIENE_SCOPE_DENIED` on `submit`, `call/…`, `runs` and `fields`, in the hygiene suite and in three engines; `action:<export>` and `action:<module>#<export>` match only their action; a 24 h link is 410 after a simulated week; rotation keeps scopes, expiry and pin, and the old link and its sessions answer 410; revocation is idempotent; an unknown token is `MOSTRA_HYGIENE_TOKEN_INVALID`; `requestId` replays return the same link without storing its secret, and only for the same parameters; secrets are 130 bits, stored hashed. After the Claude review: a view-only link can't raise a signal (`signal` scope); a link that names a version opens only that version, and gets none of another version's files; a link works only at the shell address it was minted for | `test:hygiene`; `test/unit/gateway.test.ts`; `gateway.test.ts` (week, rotate, revoke, replay); `prove-seeds.ts --only HY-03` | green; seeds (scopes unenforced, a revoked token works, lifetimes ignored) red, green when restored |
| SH-01 | verified | In Chromium, Firefox and WebKit the shell and the frame are two origins of one host. Neither reads the other's document (`SecurityError` both ways). The shell's state lives only in the shell's DOM, the frame's document has none of it, and the shell refuses to be framed by anything | `pnpm check --job e2e` (`gateway.spec.ts` › the shell and the artifact); CI e2e on macOS and Linux; `prove-seeds.ts --only SH-01` | green; seed (frame served on the shell's origin) red in all three engines, green when restored |
| SH-03 | verified | Cookie mode in Chromium, Firefox and WebKit: two `mostra-<port>` cookies, `HttpOnly`, `SameSite=Strict`, never `Secure`, unreadable from scripts, surviving a reload. **External:** real Safari 26.2 on macOS 26.2 opened a link through the gateway; the frame ran on its session, saw no cookie, completed the bridge and couldn't read the shell, before and after reloading itself, and couldn't navigate the viewer's tab (9 of 9 facts; with the sandbox removed the run fails with `top-unblocked`). Leases survive a restart: the same shell and artifact origins, bound at start, and the open frame and shell sessions reload with no new link. A taken port is leased again with `MOSTRA_ENV_PORT_TAKEN`. A cross-site origin pair selects worker mode (unit), which the gateway refuses with 501 until WP-13 | `pnpm check --job e2e`; `node packages/runtime/scripts/safari-smoke.ts` (2026-10-14, by hand); `gateway.test.ts` › restarts and taken port; `test/unit/gateway.test.ts`; `prove-seeds.ts --only SH-03` | green; Safari run passed four times (before and after GPT finding 2, and after the Claude review's fixes); seeds (Lax cookies readable by scripts, lease not reused) red, green when restored |
| SH-04 | verified | Unit: the bridge drops a wrong window, a wrong origin, non-JSON-RPC, unknown methods, the wrong direction and invalid params, answers a malformed request with -32602, and sends only to the exact origin. Its message names and shapes match the MCP Apps `2026-01-26` types (fixture from `@modelcontextprotocol/ext-apps` 2.0.3). In three engines the shell counts and drops a message from its own window, four malformed messages from the frame and a valid message from a nested frame of the artifact's origin, and the handshake completes | `pnpm --filter @mostra/protocol test` (`bridge.test.ts`); `pnpm check --job e2e` (› the bridge); `prove-seeds.ts --only SH-04` | green; seeds (origin check removed, window check removed) red, green when restored. The window seed first stayed green: no message came from the right origin and the wrong window. The nested-frame message was added |
| RT-05 | verified | A published client-only directory artifact is served (page, every asset, a deep link) with no child: `instance/status` lists no process, and the process table holds no descendant of the supervisor | `gateway.test.ts` › no process; CI integration on macOS and Linux; `prove-seeds.ts --only RT-05` | green; seed (serving spawns a process) red, green when restored |
| VR-03 | verified | Route enumeration on an artifact origin: the source, the server bundle, `registry.json`, `manifest.json`, `lock.yaml`, the snapshot and the ledger, through `..`, `%2e%2e` and `%2f`, all answer 400 or 404 with none of their bytes. The shell origin serves no artifact file. An edit to the source shows nothing until it is published. An artifact never published has no link and no session. A version whose stored files were altered is refused with `MOSTRA_HOME_INTEGRITY` until a republish repairs it, also for a frame session that exists already, after a restart and while the gateway runs (Claude review finding 5). `mostra dev` joins the enumeration in WP-10 (D96) | `gateway.test.ts` › serving versions, damaged version; `prove-seeds.ts --only VR-03` | green; seeds (whole version directory served, damaged version shown) red, green when restored |
| LL-05 | verified | A link minted without a lifetime, and the default link, open after a restart with the clock 8 days ahead (`MOSTRA_TEST_CLOCK_OFFSET_MS`), as does a frame session made before. A 24 h link is 410. The week-old link still rotates and revokes. The `mostra doctor` warning about long-lived artifacts without an always-on daemon is WP-10's, on WP-08's `daemon install` (D96, delegated by Mirza, M16) | `gateway.test.ts` › links outlive restarts and a week; `prove-seeds.ts --only LL-05` | green; seed (unbounded links expire after a week) red, green when restored |

The WP-03 render fixtures (single TSX, single MDX, a directory with `pages/`, a nested route and deep links) render through the gateway in Chromium, Firefox and WebKit with no console or page errors (`gateway.spec.ts` › WP-03's fixtures), as the specification asked. WP-03's `publish.test.ts` now asserts `PublishReceipt.url` and `tokenId` on every receipt, reuse and replay. The full suites pass: `pnpm check` (13 jobs) green locally, and CI green on macOS and Linux on `fe4cfe6`, after the Claude review's fixes (run [38639924724](https://github.com/mostra-dev/mostra/actions/runs/38639924724); before them, `9b16aba` in run [38609059488](https://github.com/mostra-dev/mostra/actions/runs/38609059488)). Every WP-05 seed, 47 with the review's, is red when planted and green when restored.

## Findings of this session's own checks

- The hygiene suite found the CSRF token stored in plain text in the ledger's WAL. It is now derived from the cookie and stored only as a hash (D98 item 2).
- Firefox reported Zod's `eval` probe as a CSP violation on the shell (`script-src 'self'`). The shell now sets Zod's `jitless` before any schema is built.
- The seed proofs exposed three weak tests: two hygiene tests that relied on earlier tests' traffic (red when run alone), and the bridge test above. All three were strengthened.
- Review of my own diff found three problems:
  - Any website could spend the guessing limit through hidden cross-site frame entries and lock viewers out. Those entries are now refused before they count.
  - Static serving fell back to `/` for a path the request check had already refused. It fails closed now.
  - The gateway served a version without checking its integrity, against FAILURE_MODEL §3.

## Independent review (D80)

- **GPT-6.1-Sol**, run through `codex review --base origin/main` (codex-cli 0.162.1, OpenAI, ChatGPT sign-in) with effort high, on 2026-10-14 against `9b16aba`. It used 2,668,071 input tokens (2,499,968 cached) and 13,906 output tokens (9,067 reasoning). It was a GPT-only run, announced before it started (D34).
- **GitHub Copilot** posted no review, as on WP-02 to WP-04.
- **CodeQL** flagged one alert, `js/insecure-temporary-file` on `tests/e2e/global-setup.ts`. The run record holds capability links and sat at a predictable shared path; it now lives in the run's mode-0700 directory, created exclusively.
- **Claude Opus 5.5** reviewed `b7fadcd` with Mirza's approval: he ran the prompt through Claude in the cloud with his credits, 2026-10-14, and the review is on [#14](https://github.com/mostra-dev/mostra/pull/14) (token use billed to his credits, not reported here). It ran the suites in a Linux container and reproduced every defect but one against a real `mostra-runtime daemon`, the browser ones in Chromium.

Both GPT findings hold and are fixed:

| # | Finding | Fix and test |
|---|---|---|
| 1 (P2) | An IPv6 bind spelled `0:0:0:0:0:0:0:1` kept that spelling in origins and the Host allowlist, so a browser's `[::1]` Host got 421 | Origins and allowlists use the host as the URL parser writes it; a `--url-host` the parser rejects is `MOSTRA_ENV_BIND_FAILED`. `test/unit/gateway.test.ts` › exact origins (three spellings and a mixed-case name); `prove-seeds.ts --only wp05-review-1` red, green when restored |
| 2 (P2) | The Safari smoke run's client parsed an incomplete trailing line when a response spanned two reads | It parses only newline-terminated lines and keeps the tail. Checked by inspection and a new Safari run (8 of 8) |

All thirteen Claude points hold. Mirza decided the three that needed him (M17), and each fix has a regression test that fails on the code before it (`node packages/runtime/scripts/prove-seeds.ts --only wp05-claude-N`, each red when planted and green when restored):

| # | Finding | Fix and test |
|---|---|---|
| 1 (medium) | One guessing count for the whole gateway, fed by frame entries any artifact's page could send, so one artifact locked out every viewer of every artifact | The count is per artifact and frame tickets don't count (D97 item 8). Unit (another artifact's links untouched), hygiene and three engines (an artifact's page loads 40 junk entries of another artifact; a fresh viewer still opens it) |
| 2 (medium) | A link pinned to one version opened any version, and the asset fallback served every version's files | A link that names a version opens only that version (M17, D97 item 9): 403 for another, no other version's files. `gateway.test.ts` (a `public/assets` file only version 2 has: 404 for the pinned link, 200 for the latest one) |
| 3 (medium) | An artifact's page could fill the host's cookie jar past the 32 KiB header limit and break every link, persistently | Headers up to 1 MiB pass; every engine keeps about 410 KB per host (measured). Past it, 431 with a page that sends `Clear-Site-Data: "cookies"` (D98 item 9). Three engines (an artifact fills the jar; both links still open) and hygiene (a full jar served; 1.1 MB answered with the clearing page) |
| 4 (medium, design) | The unsandboxed frame could replace the shell with a look-alike page | The frame is sandboxed with every capability but top navigation, keeping only the tokens the browser knows; `ui/open-link` sends the viewer elsewhere (M17, D98 item 7). Testing it found that Firefox lets even a sandboxed popup navigate `opener.top`; the shell now sends COOP, so popups have no opener. Three engines (script, `_top` link, popup), real Safari; two seeds |
| 5 (low) | Integrity was checked only when a ticket was minted | Every served file passes `gateway/integrity.ts`, which checks the version before its first file and again when a file's change time differs. `gateway.test.ts` (an open frame reloads a version tampered after a restart and while running: 500, then 200 after a republish) |
| 6 (low) | One exchange replaced the session for every tab (login CSRF) | 409 `MOSTRA_HYGIENE_SESSION_CONFLICT` unless `replace: true`; the shell shows both links' access and asks (D98 item 8). Hygiene and three engines (keep, then use the new link) |
| 7 (low) | Concurrent guesses passed the limit before any of them counted | The limit is checked inside the token check. Hygiene (60 guesses sent together: at least 30 refused, the right token among them too) |
| 8 (low) | `view/url` replayed a `requestId` whatever its parameters, handing out a wider link | Every recorded method keeps a digest of its parameters; another request under the same `requestId` is `MOSTRA_HOST_REQUEST_ID_REUSED` (D100). Unit and `gateway.test.ts` (`view/url` and `artifact/publish`) |
| 9 (low) | Other spellings of the unspecified address skipped `--url-host` | Compared in canonical form. Unit (six spellings) |
| 10 (nit) | Unmapped bind errors were `MOSTRA_HOST_INTERNAL_ERROR` | Every error no other port would fix is `MOSTRA_ENV_BIND_FAILED`. Unit (`EAFNOSUPPORT`, `EINVAL`, `ENOTSUP` from a listener) |
| 11 (nit) | The test clock offset was read unbounded | Only 0 to ten years in whole milliseconds counts; anything else is ignored and logged, and an offset in use is logged. `gateway.test.ts` (negative, `1e20`, fractional) |
| Spec | Tickets weren't bound to their shell session | A ticket works only while its shell session exists, as D98 item 3 said. Unit |
| Design | `signal` needed no scope | The `signal` scope (M17, D97 item 4). Hygiene (a review-only link gets 403) |

The review's two notes without an anchor are answered too. A re-leased port no longer serves old links' secrets to whoever holds the old port: a link works only at the shell address it was minted for (D97 item 10, `gateway.test.ts` with a squatter on the shell's port). A cross-site page opening the bare shell URL under the viewer's session needs the artifact ID and can only show the artifact the viewer already has; that stays as the reviewer judged it, a note.

Two findings of my own came out of answering it. Playwright 1.63's Firefox lost the navigation commit on pages with COOP (microsoft/playwright#42731), so about one shell navigation in 25 hung; Playwright 1.64.0, which passed its release age that day, fixes it, and Firefox then passed 68 of 68. And WebKit logs an error for sandbox tokens it doesn't know, which `verify` would have reported as the artifact's; the shell asks `sandbox.supports` first.

## Agent-facing prose (D74)

Written following the writing-for-agents guidance; not yet reviewed by Mirza:
- the hints and docs pages of the 18 new codes (three from the Claude review: `MOSTRA_HOST_REQUEST_ID_REUSED`, `MOSTRA_HYGIENE_SESSION_CONFLICT`, `MOSTRA_HYGIENE_HEADERS_TOO_LARGE`);
- the shell's viewer-facing messages (`packages/shell/src/messages.ts`), including the choice between two links and the cookie page;
- `packages/shell/AGENTS.md` and the additions to `packages/runtime/AGENTS.md`;
- the owner column of the root `AGENTS.md` invariant table;
- the `write-e2e-test` playbook.

## Untested boundaries

- The guessing limit is per artifact, in memory: a page that knows an artifact's ID can still keep that one artifact's new links waiting for a minute at a time by sending wrong tokens. Open sessions keep working, and other artifacts are untouched. A restart clears it.
- Integrity is checked by change time after the first full check. A write that keeps a file's change time (only possible by resetting the clock) would pass until the next restart.
- The 431 page clears the host's cookies, which ends every Mostra session on that host; they come back when a link is opened again.
- Every leased artifact port is bound at start (D99), so a home with many opened artifacts holds that many listeners. Idle lifecycles are WP-08's (RT-08).
- IPv6 binds are covered by unit tests only; no browser test runs over IPv6.
- Worker mode is only selected (unit). The gateway refuses a cross-site pair with 501 until WP-13 builds it.
- Real Safari runs by hand (`scripts/safari-smoke.ts`), not in CI; WebKit on macOS runs in CI.
- `@mostra/react`'s bridge costs about 28 kB brotli including Zod in every version. WP-07, which grows the client runtime, may want a lighter validator for the bridge alone.

## Commits and publication

- **Range:** `3aa4300..175a38f` on `main`: 30 signed-off commits on `wp/05-gateway` (`031ef21` to `63dda45`) and the merge commit `175a38f` of [#14](https://github.com/mostra-dev/mostra/pull/14). This report lands through its own pull request (D79).
- **On `main` after the merge:** CI [38641322353](https://github.com/mostra-dev/mostra/actions/runs/38641322353), CodeQL [38641322390](https://github.com/mostra-dev/mostra/actions/runs/38641322390) and Scorecard [38641322437](https://github.com/mostra-dev/mostra/actions/runs/38641322437), all green.
- **Packages:** nothing published. Changesets record minor releases of `@mostra/protocol`, `@mostra/react` and `@mostra/runtime`, and the first release of `@mostra/shell`. The release pipeline is WP-11's (EN-05).
- **Docs:** generated diagnostic pages for the 18 new codes in `docs/reference/`; the docs site is WP-26's.
- **Follow-ups for later packages** are in their specifications (D96): WP-06, WP-07, WP-08, WP-10, WP-13, WP-15 and WP-20.
- **Remaining dirty paths:** none in the repository. Outside it: edit scripts, the MCP Apps tarball, the seed logs, the GPT review transcript `review-wp-05.md` and copies of the Claude review (`opus-review.md`, `opus-inline.md`) in `$JCODE_SCRATCH_DIR/wp05`; Playwright 1.63's browsers stay in the Playwright cache beside 1.64's. The e2e and Safari runs now remove their homes (`MOSTRA_E2E_KEEP=1` keeps the e2e one); the 34 homes earlier runs left in `/tmp`, and the old `/tmp/mostra-e2e-run.json`, were removed.

## Next

WP-06, interaction ledger (`docs/design/work-packages/WP-06.md`).
