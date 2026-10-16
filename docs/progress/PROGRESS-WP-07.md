# WP-07 progress: client runtime and shell controls

**Status:** Done. Accepted by Mirza on 2026-10-16 ("Accepted & approved, 100%!"), merged to `main` as `b9a8422`, finalized after the merge (work-packages/README.md §4).

## Baseline

| | |
|---|---|
| Branch | `wp/07-client-runtime`, created from `origin/main` |
| Starting `HEAD` | `f7b41b6` (`origin/main` at session start, 2026-10-15: "docs(progress): finalize the WP-06 report (#19)") |
| `git status` | clean |
| `pnpm check` | green: format-lint, types, unit, integration, hygiene, e2e, build, boundaries, api, licenses, rust, docs and commits all pass, uncached (`TURBO_FORCE=true`, 4 min 18 s, macOS arm64) |
| Predecessors | WP-06 done ([PROGRESS-WP-06](PROGRESS-WP-06.md) on `origin/main`); no `RECOVERY-WP-07-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, macOS 26.2 arm64 |
| Pull request | [#20](https://github.com/mostra-dev/mostra/pull/20), merged; the fix found by `main`'s CI after it, [#21](https://github.com/mostra-dev/mostra/pull/21) |

## What was built

- **`@mostra/protocol`:**
  - the view a frame shows (`view.ts`: `ViewContext`, `VersionRef`, `DeliveryTarget`, `SubmitChannel`, `TrustedControl`, `ControlsPolicy`) and the shell's routes (`FrameTicket`, `ShellSubmitRequest`, `ChooseRequest`, `FollowRequest`, `CarryOver`, `OrphanedField`), additive to browser-protocol revision `2026-10-15`;
  - the bridge messages `mostra/fields`, `mostra/page`, `mostra/controls.request`, `mostra/flush`, `mostra/version.available`, `mostra/field.focus`, and `mostra` in `ui/initialize`'s params and result;
  - the port methods `port/trustedControls.policy` and `port/trustedControls.activated`, `HomeConfig.submitChannels`, `SubmissionSummary.deliveries` with `waiting`;
  - `MOSTRA_SUBMIT_CHANNEL_DENIED` and `MOSTRA_SUBMIT_BLOCKED`, each with its docs page.
- **`@mostra/runtime`:**
  - migration 6: `view.controls_json`, the `follow` table, and `field.version_number` (the column WP-06 reserved as `orphaned_from_version`), backfilled from the draft events;
  - field coverage (D109): the builder's static scan of field IDs (`builder/child/fields.ts`) into `registry.json`, read back by `readFieldCoverage` and matched by `coverageMatcher`; orphans derived per view at submit, carry-over and the banner, never stored;
  - the channel policy a ticket resolves (`gateway/controls.ts`, D108), recorded on the view and checked by every submit and by the page's writes to a review set's choice;
  - the shell's trusted Submit, Choose, follow, carry-over and its own event stream, behind the route table's checks; the ticket offers only the controls the link's scopes can use;
  - `submission.retrying`, once per waiting delivery, so a viewer sees "Pending delivery";
  - `browserProtocolRevision` in `envDigest`; `<meta name="mostra-version">` in every build (D115); a test-only next revision (`MOSTRA_TEST_BROWSER_REVISION_NEXT`).
- **`@mostra/react`:** `useField`, `useSubmit`, `useSubmitControl`, `useSignal`, `useChoice`, `useViewer`, `useArtifact`, `window.storage`, `@mostra/react/form` (react-hook-form) and `@mostra/react/router` (`pages/` per delivery target), over one `Store`: optimistic edits with a 400 ms debounce and flushes on blur, `visibilitychange`, `pagehide` and before submit; per-field bases and conflicts with keep-mine and take-theirs; an IndexedDB journal replayed in order by the next page, each entry against its own view; BroadcastChannel between tabs; the event stream with its long-poll fallback; defaults written before a submit (D110).
- **`@mostra/shell`:** the rail and the trusted zone (Submit and Choose, rendered only where the view's policy and the link allow them), required-field blockers checked against the shell's own copy of the draft, the delivery receipt, the version banner with Switch, Later and "Always follow this artifact", and the "Not carried over" panel; one frame element per view (history and focus kept, D115).
- **Docs:** INTERFACES §2.3, §4, §5, §6, §7 and §11 and DATA_MODEL §3 and §4 updated; D108 to D115; the browser-protocol playbook (`docs/agents/change-browser-protocol.md`); `AGENTS.md` of `react`, `shell` and `runtime`; VERIFIED_FACTS for WP-07.

## Decisions taken in the package

M19 delegated every question (2026-10-15T12:39Z): **D108** channel policy (home default, the `trustedControls` port per view, narrowing on failure); **D109** field coverage and derived orphans; **D110** defaults written before submit; **D111** delivery targets, frozen fixtures per revision, prose; **D112** `window.storage` semantics and limits; **D113** `useChoice`'s candidates; **D114** up to ten Claude Opus reviews (amends D80); **D115** a page built for another version than its view saves nothing and is entered again.

## Evidence

Every check runs through the real interfaces: pages in Chromium, Firefox and WebKit through the real shell, gateway and daemon (`tests/e2e`), React's hooks in a real React DOM in Chromium (`packages/react` `browser` project), the frozen version against real gateways (`integration`), and the ledger in-process. Every row's checks also ran with a seeded violation (`node packages/runtime/scripts/prove-seeds.ts --only <ID>`): 18 seeds, each red when planted and green when restored; the unit-level fixes (saves retried when the stream returns, the coverage matcher, migration 6's backfill, the pre-commit ESLint job) were seeded by hand the same way. After both reviews' fixes, an uncached `pnpm check` is green and the full e2e suite passed twice in a row in three engines (282 of 282, 8.6 min; the IN-04 adoption test added after it passes in three engines); CI runs it on macOS and Linux.

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| AU-08 | verified | Every hook of INTERFACES §2.3 that WP-07 owns (`useField`, `useSubmit`, `useSubmitControl`, `useSignal`, `useChoice`, `useViewer`, `useArtifact`), the react-hook-form adapter and `window.storage`: unit tests of the store against a fake gateway, browser tests of each hook in Chromium, and a fixture using all of them through the real shell and gateway in three engines; `window.storage` passes a compatibility suite (methods, return shapes, JSON text, missing key `null`, delete, list with prefix, personal and shared scope, others' shared writes, 1 MiB refusal, invalid keys, last write wins, a write that waits until saved, `MOSTRA_FIELD_CONFLICT` when other writers never let it land); the form adapter saves every answer, field arrays as one answer through append and remove, and resets. `useAction` and `useLive` are WP-08's | `pnpm --filter @mostra/react test`; `pnpm check --job e2e` | pass; seeds (missing key not null; artifact submit where the host takes the shell's only) red, then green |
| AU-09 | validated | A `pages/` artifact navigates with browser history behind the gateway, deep links load their page, and the shell records the current page (`data-shell-page`, `mostra/page`); the same build marked `static` routes by hash on a host with no fallback, and marked `mcp-app` by memory with a frame URL that never changes. The exporters (WP-13 static, WP-17 MCP Apps) write the marker and repeat the check; comments record the page in WP-20 | `pnpm check --job e2e` (`pages.spec.ts`) | pass; seed (static export with browser history) red, then green |
| IN-02 | verified | An edit still inside the debounce reaches the gateway when the tab closes (`visibilitychange`, `pagehide`, `keepalive`); an edit made while the daemon is down is journaled, survives closing the whole browser, and is sent when the browser opens the artifact again (persistent profile, daemon restarted), in three engines | `pnpm check --job e2e` (`client.spec.ts`) | pass; seeds (no close-time flush: red in two engines, WebKit saves on blur; a journal that keeps nothing) red, then green |
| IN-03 | verified | Two tabs and a second browser context editing different fields converge through the event stream; the same field edited in two places surfaces a conflict with both values, and keeping mine wins everywhere, in three engines | as above | pass; seed (edits sent as based on the newest revision) red, then green |
| IN-04 | verified | Offline edits are journaled and replay in order when the page is back; edits made offline against a version since replaced replay as that version's view, then map by ID ("name") or become an orphan ("notes", read-only in the panel, delivered with `fromVersion: 1`); a tab closed with its edit unsent while version 2 is published: the browser reopens at version 2 and the journal replays as version 1's view (the orphan's `fromVersion` is 1); unit: replay, adoption of closed tabs' entries only, each under the view it was made in, stale views | as above; `pnpm --filter @mostra/react test` | pass; seeds (journal keeps nothing; adopted entries replayed as the adopting page's view) red, then green |
| IN-13 | verified | The receipt shows Submitted (saved by Mostra), then Pending delivery while the expected host is away, then Delivered when it returns; a host's terminal refusal shows Undeliverable with its reason; unit: `waiting` and one `submission.retrying` per delivery; a delivery event that arrives before the submit's answer, and an answer older than an event, never take the receipt back. Mirza accepted the wording with the package | `pnpm check --job e2e` (`controls.spec.ts`); unit `interaction-wp07.test.ts` | pass; seed (never Pending delivery) red, then green |
| SH-02 | verified | The artifact can't render, click or forge the trusted Submit: synthetic clicks, an overlay confined to the frame, requests to the shell's routes from the artifact's origin or with the frame's CSRF token, and forged bridge messages make no submission; the artifact requests a label and confirmation the shell shows; a host taking the shell channel only (`HomeConfig.submitChannels` or the port) gets `MOSTRA_SUBMIT_CHANNEL_DENIED` for the page's submit and choice, also as a repeat; every submission records its channel and viewer; a link without the submit scope is offered no trusted Submit, and one without `review` records no choice through the page; the trusted controls take no click for 500 ms after they appear or change or the shell's page is shown (a Choose swapped under the pointer, a popup of the shell under a second click), and the artifact's label can't read as a shell state. Conformance scenarios: WP-12 | `pnpm check --job e2e`; `pnpm --filter @mostra/runtime test:hygiene`; unit `controls.test.ts`, `interaction-wp07.test.ts` | pass; seeds (channels ignored; trusted Submit recorded as artifact; controls not narrowed by scope; controls armed at once) red, then green |
| VR-04 | verified | An open view shows the banner after a publish, on the shell's own stream, without a reload; the view switches only when the viewer chooses, in a new frame that adds nothing to the tab's history; answers carry over by ID | `pnpm check --job e2e` (`versions.spec.ts`) | pass; seeds (no newer version seen; frame navigated instead of replaced) red, then green |
| VR-05 | verified | A version without the "notes" field: the banner counts one answer that won't carry over, the panel shows it read-only and copyable after the switch, and results and Markdown carry it in `orphaned` with `fromVersion`; unit: coverage scan and matcher, carry-over, snapshot orphans, migration 6's backfill | as above; unit `coverage.test.ts`, `interaction-wp07.test.ts` | pass; seed (every version covers every field) red, then green |
| VR-10 | verified | The version frozen at revision `2026-10-15` (`test/fixtures/browser-revisions/`) saves, signals and submits through today's gateway, one that also serves a newer, test-only revision, and a shell that sends a channel, policy and target the page doesn't know; every revision served has a frozen version, and only those | `pnpm --filter @mostra/runtime test:integration -- browser-revisions` | pass; seed (a gateway that serves only its newest revision) red, then green |
| LL-03 | verified | "Always follow this artifact" is kept across reloads; a new version loads by itself; an unsaved edit holds it with the banner until saved; a version that would orphan an answer waits for the viewer with the count; an answer already not carried over doesn't hold the next version; the successor frame keeps the viewer's focus | `pnpm check --job e2e` (`versions.spec.ts`) | pass; seeds (follow over unsaved edits and orphans; focus not kept) red, then green |

## Reviews (D80)

- **GPT-6.1-Sol through `codex review --base origin/main`** (codex-cli 0.162.1, OpenAI, ChatGPT sign-in), effort high, on 2026-10-15 against `3e68e3a`: 5,481,253 input tokens (5,271,424 cached) and 20,114 output tokens (10,773 reasoning). A GPT-only run (D34). Its browser checks were blocked by its sandbox; it reproduced several findings with the fake gateway.
- **Copilot**: requested on every push; as on earlier packages, the requester's quota is used up, so it reviewed nothing.
- **Claude Opus 5.5**, approved by Mirza (D114; the fourth of ten), run by him through Claude Code on the web with the cloud credits on 2026-10-16 against `b85f76a`; it posted [its review on the pull request](https://github.com/mostra-dev/mostra/pull/20#pullrequestreview-5545360003), 13 findings (2 high, 5 medium, 6 low). Token usage isn't reported by that surface. It confirmed the GPT review's fixes it checked.

The GPT review's 15 findings, all fixed. Each has a regression test that fails on the code before the fix (checked by running it against that code) and passes after it:

| Finding | Fix | Proof |
|---|---|---|
| 1 (P1) A conflict left unresolved was journaled on the newer revision, so the next page overwrote theirs | The held edit keeps the base it was made on; only `keepMine()` moves it | Store test: a closed tab's conflict comes back as a conflict on the next page; keep-mine then writes |
| 2 (P1) The trusted Submit named the newer of the shell's and the frame's revisions | It names the revision the page confirmed (`submitRevision`); a newer one is refused as moved | Shell model test |
| 3 (P1) A frame that didn't answer the flush still got the shell's draft submitted | A page with WP-07's runtime must answer, or nothing is submitted ("The page didn't confirm…"); a page still loading can't submit; a pre-WP-07 version keeps the old path | Shell model test; e2e in three engines with a page that never hears the flush |
| 4 (P1) Another device's sensitive change, whose value events omit, could be submitted while the page showed the old value | The field is marked unknown until a snapshot brings it: an edit of it conflicts, and a submit waits for the snapshot | Store test |
| 5 (P1) The form adapter's `keepDirtyValues` kept a saved field's old value after another writer changed it | The form follows the store field by field (`setValue`), whose value is the viewer's own unsaved edit while there is one | Browser test |
| 6 (P2) Edits of one field left by two closed tabs collapsed into one | The older ones become mutations of their own, sent first; the newest meets them as a conflict | Store test |
| 7 (P2) A refused value lived only in memory | It is journaled before its mutation is forgotten | Store test |
| 8 (P2) A snapshot older than applied events rolled fields back | A snapshot replaces a document only when it is as new as what the page saw; an older one adds only newer fields | Store test; the shell's reducer the same way (shell model test) |
| 9 (P2) Keepalive saves of a hidden page stayed in the queue | Each answered request leaves the queue (`#dequeue`) | Store test |
| 10 (P2) `window.storage` writes resolved before Mostra had them | They resolve once saved, refused or in conflict; offline they wait with the journal | Browser test |
| 11 (P2) A form field that left the page kept blocking and had its default written | The adapter releases a field when its input unmounts or `unregister` removes it | Browser test |
| 12 (P2) The scan trusted literal options a spread after them could replace | Options are read in order; a spread or computed key forgets what came before; a `useForm` id a spread may replace opens the coverage | Coverage test |
| 13 (P2) A version published between the ticket and the shell's stream was never learned | `StreamSnapshot.latest` (additive to `2026-10-15`) carries the latest version; the shell takes a newer one | Runtime and shell model tests |
| 14 (P2) An asynchronous Standard Schema was treated as valid | The field shows "Checking this answer…" (a blocker) until the check settles, and a submit waits for it | Browser test |
| 15 (P2) The "Not carried over" panel didn't follow later edits | It is read again whenever the draft changes | e2e in three engines: an older version's tab changes the answer, the panel shows it |

The Claude Opus review's 13 findings, all fixed. Each has a regression test that fails on the code before the fix (checked by running it against that code) and passes after it:

| Finding | Fix | Proof |
|---|---|---|
| 1 (high) `useFieldArray` append or remove crashed the page ("Maximum update depth exceeded") and left overlapping fields, a removed row coming back | The form saves leaves: any value that isn't a plain object, so a field array is one answer; registrations follow the leaf a field lives in; a released field is let go after React's commit, never inside it | Browser test: append, remove, a row's own rule as a blocker, reload |
| 2 (high) `form.reset()` wasn't saved, so a submit sent what the viewer cleared | Every change of the form's values is saved, resets included; before a submit the form saves what it shows | Browser test: type, flush, reset, prepare: the draft holds the cleared value |
| 3 (medium) A lagging stream let a submit confirm a revision the page never showed | The page names the revision its stream showed; if the stream hasn't reached the flushed one, the page resyncs and the server refuses the stale submit as moved | Store test with events held |
| 4 (medium) A frame whose first handshake failed ran in local mode for good, while the shell said "Saved" | A framed page retries the session and handshake with backoff (0.5 s to 8 s) and never goes local; edits before the first snapshot are journaled under the session's viewer; the rail says "Connecting…" until the page reports | e2e in three engines (two failed session reads); store test |
| 5 (medium) A page's strict reading of the view meant a later shell's new channel, policy or target dropped every published version to local mode | Pages read `mostra` as `ViewContextWire` through `readViewContext`: unknown channels aren't allowed, an unknown policy or scope is `once` per viewer, an unknown target is `live`; the frozen version was frozen again from this code (the revision is unreleased) | Protocol test with the review's probe values; VR-10 case: the frozen page through a shell sending them |
| 6 (medium) The artifact could change a trusted control as it was clicked: swap Choose's target, drop the confirmation, label Submit "Submitted", or raise the shell in a popup under a second click | Controls take clicks only 500 ms after they appear, change, or the page is shown; requests wait while the pointer is over the trusted zone; a confirmation stays for the view; the shell's state words are refused as labels | Shell model tests; e2e in three engines (a swapped Choose ignores the click; a fresh shell page's Submit starts disabled); seed |
| 7 (medium) A link without `review` still recorded choices through the page | Choice fields need the `review` scope (`MOSTRA_HYGIENE_SCOPE_DENIED`, 403) | Runtime test |
| 8 (low) A delivery event could arrive before the submit's answer and be lost, leaving the receipt on "Submitted" | The submit answer is read after the outbox's first step; early delivery events wait for their submission; a summary never replaces a newer delivery state (shell and page) | Runtime, store and shell model tests |
| 9 (low) `window.storage.set` resolved after repeated conflicts while unsaved | It retries with backoff, then rejects with the new `MOSTRA_FIELD_CONFLICT` and takes the other writer's value | Browser test |
| 10 (low) A `trustedControls` host that was away gave new views the home default | A host that names `trustedControls` in `HomeConfig.ports` is expected: while it's away, views get the shell channel only | Unit test |
| 11 (low) A long label or very many fields made every report to the shell throw | Labels and errors are shortened to the bridge's limits, lists capped (blockers first), and a failed report is logged | Unit test against the bridge's schemas |
| 12 (low) A closed tab's pending edits replayed as the adopting page's view | Pending edits are grouped by view and sent under the view they were made in | Store test; e2e in three engines (close offline, publish version 2, reopen); seed |
| 13 (low) Switch and Follow opened the latest version, not the one whose orphans were counted | The ticket asks for the counted version | e2e assertion on the ticket request |

## Deviations

- **Size budgets.** `@mostra/react` grew with the client runtime: 45 kB with Zod and 22 kB without (from 30 and 7 kB); `@mostra/protocol`'s entry rose to 29 kB and the bridge to 8.5 kB (after moving the view context into `view.ts`, which brought the bridge from 10.1 to 8.2 kB).
- **The frozen `2026-10-15` version was frozen again** after the Claude review's finding 5, since the revision isn't released: the first freeze embedded a reader that refused later view values.
- **A pre-commit ESLint job.** REPO_STANDARDS §5 says pre-commit lints staged files; it ran Biome only, so React hooks rule violations reached CI. `lefthook.yml` now runs ESLint on staged TypeScript too.

## Agent-facing and viewer-facing prose

Diagnostic hints and `AGENTS.md` additions are delegated as in WP-03 to WP-06 (D111). The viewer-facing words of the shell (`packages/shell/src/words.ts`), the receipt's states included (IN-13), were shown to Mirza with the candidate and accepted with the package.

## Untested boundaries

- Static export and MCP App routing are checked on real builds carrying the target marker; the exporters themselves are WP-13's and WP-17's, which repeat the check.
- Real Safari wasn't run for WP-07's flows (Playwright WebKit was).
- The conformance kit's shell and channel scenarios are WP-12's; comments recording the page are WP-20's.
- The trusted controls' arming (500 ms) is a timing defense like browsers' permission prompts: it stops a click aimed elsewhere, not a viewer who waits and clicks a control they didn't read.
- Web Locks need a secure context: on plain HTTP over a LAN, tab presence falls back to a BroadcastChannel roll call (300 ms), which no test exercises: the store's tests cover the presence interface it implements, and every browser test runs where Web Locks exist.

## After the merge

`main`'s CI on the merge commit failed once, in the new IN-04 adoption test on Linux Chromium; it had passed in both legs of the branch's CI. It reproduced locally (3 of 24 runs, Chromium and Firefox), and an instrumented copy showed the cause, a defect in the shell rather than in the test: the shell built the state for a page's control request from a copy that follows renders (`latestStateRef`), so a request arriving just after a stream event (the page's `useSubmitControl` and `useChoice` on mount) put the draft's revision back, and the "Not carried over" panel stayed stale. [#21](https://github.com/mostra-dev/mostra/pull/21) applies every control request to the newest state (`applyControlRequests`); the adoption test then passed 48 of 48 runs in three engines, with a shell model test beside it.

## Commits and publication

- **Range:** `f7b41b6..b9a8422` on `main`: 32 signed-off commits on `wp/07-client-runtime` (`5724096` to `5325ae4`) and the merge commit `b9a8422` of [#20](https://github.com/mostra-dev/mostra/pull/20); then [#21](https://github.com/mostra-dev/mostra/pull/21), the fix above. This report lands through its own pull request (D79).
- **On `main` after the merge:** CodeQL and Scorecard green; CI red only for the e2e test above, which #21 fixes.
- **Packages:** nothing published. Changesets record minor releases of `@mostra/protocol`, `@mostra/react`, `@mostra/runtime` and `@mostra/shell`; the release pipeline is WP-11's (EN-05).
- **Docs:** generated pages for the new diagnostic codes in `docs/reference/`; the docs site is WP-26's.
- **Follow-ups for later packages** are in their specifications ("From WP-07"): WP-08, WP-09, WP-12, WP-13, WP-17, WP-18 and WP-20.
- **Remaining dirty paths:** none in the repository. Outside it: scripts, logs, review transcripts and traces in `$JCODE_SCRATCH_DIR/wp07`.

## Next

WP-08, workers, actions and live data (`docs/design/work-packages/WP-08.md`).

