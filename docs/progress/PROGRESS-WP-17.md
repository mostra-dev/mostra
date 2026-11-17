# WP-17 progress: MCP Apps export

**Status:** In progress. Owns MC-02 and MC-03 ([specification](../design/work-packages/WP-17.md)), with #139 and #157 on its milestone.

## Baseline

| | |
|---|---|
| Branch | `wp/17-mcp-apps`, created from `origin/main` |
| Starting `HEAD` | `8165633` (`origin/main`, 2026-11-16: "docs: the test deployment is retired; candidates are checked on the hosted service (#170)"), merged through the merge queue at this session's start with Mirza's go (M74) |
| `git status` | clean |
| `pnpm check` | on `8165633` in place, 2026-11-16, with Cargo's target directory on the external disk: the full run reached its 50-minute deadline (`--deadline 50`) still running, on a Mac shared with other sessions' builds and tests; the static jobs then ran alone (below), and the full baseline is CI's `ci:full` run on this pull request (below) |
| Static jobs (format-lint, types, build, boundaries, api, docs, licenses) | `pnpm check --job format-lint --job types --job build --job boundaries --job api --job docs --job licenses`: all seven green (28.7 s, Turborepo's cache warm from the full run) |
| CI baseline | the `ci:full` run 43860989189 on this pull request's first commit (`a0bc843`, every job on every leg, Windows arm64 and the six-platform release rehearsal included): green |
| Predecessors | WP-16 done ([PROGRESS-WP-16](PROGRESS-WP-16.md)) on `origin/main`, released as Mostra 0.15.1; no `RECOVERY-WP-17-*.md`; the `WP-17` milestone holds #139 and #157 |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |

## Decisions with Mirza

- **2026-11-16T10:45Z (M74)**, his answers to the session's first questions: merge #170 before branching ("I agree with you, let's merge it"); waits are chained at most 51 minutes each; nothing installed for the external checks (VS Code and the rest) until he sets them up at the end; and every other question delegated: "I trust you to make the most robust, appropriate, high-quality … decisions". Recorded as **D175**.

## What was built

| Part | Where | What it does |
|---|---|---|
| The app channel | `packages/protocol/src/methods/app/`, `packages/runtime/src/gateway/app.ts` | `app/open` opens a view through a link's secret with an `app` session; `app/request` runs one browser-protocol route through the gateway's own route specs, session and scope (D175 item 4); migration 18 admits the `app` session mode |
| The MCP App exporter | `plugins/mcp-app/` (`@mostra/plugin-mcp-app`) | Mostra's first first-party plugin, on `@mostra/contract-exporter`: a version's client build re-bundled with Rolldown into one self-contained `ui://mostra/view/<versionId>` document, its CSP declared from the artifact's own origins, the token table for the host's variables (D175 item 2) |
| Bundled plugins and `app/page` | `packages/runtime/src/plugins/` | Every home has the exporter as scope `bundled`, below an artifact's and the home's, never removable; `app/page` makes and keeps a version's MCP App (D175 items 3, 4) |
| The MCP server's MCP Apps | `packages/mcp/src/app.ts`, `loader.ts`, `server.ts`, `tools.ts` | Eleven app-only tools, the loader `ui://mostra/app` named on `artifact_open` with the version in `structuredContent`, the page resource template, and none of it for a client known to lack MCP Apps (D175 items 1, 5) |
| The page inline | `packages/react/src/runtime/mcp-*.ts`, `inline.ts` | The `mcp-app` target: the host connection (the loader's or its own), the transport over the app-only tools, the host's look, the bar (save state, blockers, Submit and Choose through the artifact channel, "Open the full page"), and what the frame lacks said explicitly (D175 items 6, 7) |
| Cloud chat hosts | `packages/runtime/src/server/app-pages.ts`, `hosted.ts`, `mcp.ts`, `link/` | A hosted home keeps each version's page from its owner (`hosted/page`) or fetches it through the relay, serves it with the owner offline, and renders per chat host (D160, D175 item 8) |
| #139 | `packages/runtime/src/link/reimport.ts` | Followed submissions read again one at a time in hosted cursor order, the first that fails holding the rest back (D175 item 9) |
| #157 | `packages/mcp/src/verify-run.ts`, `relay/author.progress` | `artifact_verify` answers within 45 s or `running`, joins the run under way, and hears the owner's stages over remote MCP (D175 item 10) |
| The reference host | `tests/e2e/support/mcp-apps-host*.ts`, `specs/mcp-apps.spec.ts` | ext-apps 2.0.4's `AppBridge` in a double-iframe sandbox on another origin, its CSP from the resource, its MCP client a real `mostra mcp --embedded` over stdio |

## Evidence

Every check runs through the real interface: a real daemon or remote server over the host protocol, `mostra mcp` over stdio and HTTP, and the published ext-apps 2.0.4 `AppBridge` as the reference host in Chromium, Firefox and WebKit. Each row's seeded violations (`node packages/runtime/scripts/prove-seeds.ts --only <ID>`) go red when planted and green when restored.

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| MC-02 | validated | The ext-apps reference host renders an exported artifact through the loader; fields, submit, a plain call and an action run round-trip through the app-only tools, and the answer reaches `results`; the resource declares its CSP (the artifact's own origin, never a package's) and the host's variables reach the page's tokens; the full page is always offered; what was typed is saved before the host removes the page; AU-09: the real exporter's output routes in memory; one self-contained document, its script and style never ended early; the bundled exporter in every home, never removed, shadowed by an installed one; `app/page` made once and kept; app-only tools hidden from the model and left out for a client without MCP Apps; the app channel's scopes, its own session and its refusals; in a cloud chat host, the hosted page kept, fetched from the owner and served with the owner away, answers saved and submitted as the account and reaching the owner, and nothing of it for a chat host whose policy shows links. External in Claude Desktop and VS Code: with Mirza at acceptance (Untested boundaries) | `MOSTRA_E2E_BROWSER=<engine> npx playwright test specs/mcp-apps.spec.ts specs/pages.spec.ts` (tests/e2e); `vitest --project integration mcp-apps.test.ts` (group `extensions`), `remote-mcp-apps.test.ts` (`remote-access`); `vitest --project unit app-pages.test.ts`; `plugins/mcp-app` `exporter.test.ts`; `packages/mcp` `apps.test.ts`; `prove-seeds.ts --only MC-02` | mcp-apps.spec 6 and pages.spec 3 pass in each engine; 11 and 3 integration, 6 unit, 9 exporter and 7 MCP tests pass; 16 seeds red, then green |
| MC-03 | verified | In the MCP App in a browser, each unavailable feature states its message in the bar: presence, the review overlay, a frame and an outside origin the host's policy blocks (named), a stream's batches arriving whole, a version newer than the page's, Submit and Choose where only the shell's channel may submit, and a host without the app-only tools, where answers stay in this browser | `MOSTRA_E2E_BROWSER=<engine> npx playwright test specs/mcp-apps.spec.ts -g "lacks"` (tests/e2e); `prove-seeds.ts --only MC-03` | 3 tests pass in Chromium, Firefox and WebKit; 8 seeds red, then green |

## Issues on the milestone

| Issue | What was done | Test, and its seed |
|---|---|---|
| #139 | Two in-order streams, the hosted outbox's deliveries and the follow's reads again, each insert only what the log lacks, so their union keeps the hosted order once neither skips ahead: the follow keeps each missing submission's hosted cursor (`remote_missing.hosted_cursor`, migration 18), and one line per server reads them one at a time in that order, the first that fails holding the rest back (`link/reimport.ts`). RM-08's order check is untouched and as strict | `reimport.test.ts` (reads finishing in reverse order import in the hosted order; a failure holds the line; a kick while it runs reads the newcomer in turn) and `imports.test.ts` (the cursor kept); 5 RM-08 seeds red, then green; RM-08's order check passed three runs in a row |
| #157 | `artifact_verify` answers within 45 s: the verdict, or `{ status: "running", stage, elapsedSeconds }`; the same call again joins the run under way, from any request's server (`McpServerOptions.scope`), and a verdict nobody collected waits 10 minutes for the call that asks again; over remote MCP the owner sends verify's stages back (`relay/author.progress`). The load in the report was two abandoned WP-30 repro daemons, stopped at this session's start | `packages/mcp` `verify.test.ts` (4 tests: running with the stage, the join, the kept verdict, and over HTTP across two requests' servers) and `remote-mcp.test.ts` (the owner's stages arrive); 4 seeds red, then green |

## Found while proving

- **By my own diff review:** the app channel gave every route `client: undefined`, so on a hosted home every chat-host user's inline submits counted against one per-address bucket (`unknown`), across homes. A chat host's server calls from addresses all its users share, so the caller is now the account the session's grant names (`appCallerOf`, `account:<id>`, and `local` on a person's own home), for `app/open`'s view admission and every route's rates. `app-dispatch.test.ts` checks it; its seed goes red, then green.
- **By the first `ci:full` run** (44081871670, on `f2949a8`), three faults, each fixed at its root:
  - the Rust host crate's wire types weren't regenerated after the protocol's new methods (`cargo run -p mostra-host-codegen -- write`);
  - a release would have left `@mostra/plugin-mcp-app`, the first package under `plugins/`, at the last release's version and couldn't have published it: `tools/release/versions.ts`, `packages/bundle/scripts/publish-npm.ts` and `notes.ts` looked for the group's packages under `packages/` only, by a name rule; they now read every manifest under `packages/` and `plugins/`. `versions.test.ts` checks it, red on the old code, with a seed;
  - a stdio client without MCP Apps was sent `notifications/tools/list_changed` before `initialize`'s answer, since the app-only tools were taken out through `disable()`, which announces a change. They are now left out as the list reads them, announcing nothing to a client that hasn't listed tools yet. `apps.test.ts` checks it, red with `disable()`, with a seed.
- **By CodeQL** (alert 93, `js/bad-tag-filter`): a test's extraction of the loader's script matched only `</script>` in lower case; it now finds the one script in any casing and checks that no casing of a closing tag is in it.
- **By running Claude Desktop's exact launch** (the checkout's `mostra mcp --embedded` over stdio, a scratch home, a client naming MCP Apps): every page's `_meta.ui` was empty, leaving its border to each host's own default. MCP Apps recommends an explicit value, so every page now says `prefersBorder`, `true` unless the exporter's option sets it, framing the page and its bar as one card in every host.

## Untested boundaries

- **Claude Desktop and VS Code** (MC-02's external check) and **claude.ai** (MC-04's inline round trip, WP-30's row to extend): Mirza runs them at acceptance (M74); ChatGPT's waits for a Business workspace (M60).
- **A chat host's own CSP and frame**: the reference host enforces the spec's policy as ext-apps' does; each real host's differs, recorded per host with the external checks.
- **The verify run kept by the remote server** is joined across requests in `@mostra/mcp`'s test, not in a remote suite: a remote verify past 45 s on a real owner wasn't forced.
