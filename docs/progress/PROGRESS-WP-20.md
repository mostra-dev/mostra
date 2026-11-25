# WP-20 progress: Review layer and shell design

**Status:** accepted by Mirza on 2026-11-24 ("I absolutely accept"), with the footer, his phone check's notes and the review's findings fixed before the merge. Owns RV-01, RV-02, RV-03, RV-04, RV-05, SH-05, SH-06, CO-06 and HO-11
([specification](../design/work-packages/WP-20.md)), with #85, #152, #167, #188, #194 and #218 on
its milestone.

## Baseline

| | |
|---|---|
| Branch | `wp/20-review`, created from `origin/main` |
| Starting `HEAD` | `ef882eb7` (`origin/main`, 2026-11-23: "docs: WP-18's closeout, Mostra 0.19.0, WP-19 next (#243)") |
| `git status` | clean |
| Static jobs | `pnpm check --job format-lint --job types --job build --job boundaries --job api --job docs --job licenses` on `ef882eb7`, 2026-11-23: types, build, boundaries, api and licenses green; format-lint and docs red in that run only, each green alone right after (`biome ci .`: no error; `node tools/docs/diagnostics.ts check`: 209 codes, each with a current page). The docs check read `@mostra/protocol`'s `dist/` while the parallel build was writing it, and biome met a file a test was writing at the moment it scanned; nothing is wrong on `main` |
| Full baseline | CI's `ci:full` run on this pull request's first commit (a full local `pnpm check` is load-bound on this Mac, as in WP-14 to WP-18) |
| Predecessors | WP-07 ([PROGRESS-WP-07](PROGRESS-WP-07.md)) and WP-18 ([PROGRESS-WP-18](PROGRESS-WP-18.md)) on `origin/main`; no `RECOVERY-WP-20-*.md`; the `WP-20` milestone holds #85, #152, #167, #188, #194 and #218 |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |

## Decisions

Mirza delegated every decision of this package at M100 ("I trust you to make the most robust … decision") and was away while it was built, so each is recorded as **D183** (items 1 to 16), worded there. In short:

1. **Who sees a thread.** A page sees the threads it started, wrote in or is mentioned in; the artifact's owner, and every viewer under `team.visibility: "names"`, see all; agents and hosts see all.
2. **Threads travel with the submission.** A submission's snapshot carries the threads its viewer started or wrote in, as they stand, with each crop's state; results, `review/export` and the submissions port read them from there.
3. **Mentions** name people the page may know, by their per-artifact key, and raise one host-only `review.mentioned` per person per comment, naming the person's `ref` for hosts; pages never see it, and Mostra notifies nobody (CO-06, D10).
4. **Crops** are taken after the thread commits, written once: the host's `capture` port first, else the verify runner's browser at the view's version, viewport, answers and light or dark; three attempts, then `failed` with the reason. A hosted home asks the owner instance over the relay (`review/crop`), which keeps a copy. Submit waits up to 20 s for the viewer's pending crops.
5. **The `reviews` port** mirrors each thread change and choice, best effort and never retried, like draft mirrors (D105).
6. **Anchors** keep every layer that applies (provider data, `data-review-id`, CSS and text-quote selectors, the rect with viewport, DPR and scroll, the page, the review set and candidate, the frames above it) and resolve in that order; a pin that can't be placed isn't drawn, and its thread stays listed.
7. **Served frames** carry the review agent, written inline into every page of the version but its entry, so a frame the artifact itself sandboxes anchors semantically too; opaque frames anchor by place and crop. Artifact pages may frame each other (`frame-ancestors 'self' <shell>`, amending D98 item 4).
8. **Review sets** are the kit's (`@mostra/kit/review`): gallery, focus, compare of two to four with synchronized scrolling and a pixel difference drawn by the browser (`mix-blend-mode: difference`), and the trusted Choose. Candidates that are other versions or artifacts (ROUND-3 §2's `<Candidate artifact version>`) are left for a later package (deviation below).
9. **#188.** A Choose's label may be up to 256 characters (`CHOICE_LABEL_MAX`); the bar shortens what it shows, and the button's name and title carry it whole. A Submit's label stays at 48.
10. **The receipt is gone** (D175 item 12): the status beside Submit says Submitted, Delivered, Pending delivery or Undeliverable, opens to each host's line and a stale view's note; on a hosted link it says Sent.
11. **The server's pages**: Mostra's own name is its wordmark in every theme; an operator's name is set in Jost as a mark; a client's unchecked name reads "An app calling itself …".
12. to 14., 16. The overlay's place (above the frame, in the shell), #152's re-entry of an unpainted frame, #167's report, and the machinery (module `review`, area `REVIEW`, migration 20, budgets).
15. **Selected words and comment mode** (after Mirza's review of the candidate, M101): selected words offer a comment beside them, anchored as those words (`selection: true`); comment mode says "Tap (or Click) what you want to comment on." with Cancel; crops follow the viewer's light or dark.

## What was built

| Part | Where | What it does |
|---|---|---|
| Protocol | `packages/protocol/src/{review,review-threads}.ts`, `bridge.ts`, `methods/review/export.ts`, `methods/port/{capture-screenshot,reviews-mirror}.ts`, `diagnostics/codes/review.ts` | Anchors, threads and their requests; bridge messages `mostra/review.hitTest`, `.track`, `.positions`, `.scrollTo` and `mostra/surfaces`; `review/export`; the `capture` and `reviews` ports; the `REVIEW` area (7 codes) |
| Ledger and interaction | `packages/runtime/src/ledger/migrations.ts` (20), `src/interaction/{review,markdown}.ts` | `thread` and `comment`, write-once by triggers; threads, replies, resolve, reopen, mentions, visibility, events, snapshots and results |
| Crops and export | `packages/runtime/src/review/index.ts`, `src/verify/{index,sandbox,runner}.ts`, `packages/verify/src/runner.ts` | The capture queue, the home's `blobs/`, the verify runner's `verify/crop` (a sandbox seeded with the viewer's answers), `review/export` in Markdown and JSON with crop paths |
| Gateway | `packages/runtime/src/gateway/{browser,index,http}.ts` | `GET/POST …/review/threads`, `…/threads/{id}/comments`, `…/status`, `…/crop`, behind the shell session, its CSRF token, `Origin` and the `review` scope; Submit waits for pending crops |
| Hosted homes | `packages/runtime/src/server/hosted.ts`, `src/link/author.ts`, `src/instance/index.ts` | Crops rendered on the owner over the relay; crops removed with a removed artifact; #167's report |
| Page | `packages/react/src/review/` | The review agent (hit tests, anchors, tracking, served frames' nested protocol), built-in providers (chart datum, slide and step, timeline time), `registerAnchorProvider`, `useReviewSurface` |
| Shell | `packages/shell/src/{review.tsx,viewer.tsx,chrome.tsx,model.ts,words.ts,shell.css}` | Pins, comment mode, composer with mentions, threads with crops, replies, resolve and reopen, the panel and the phone's sheet; the status beside Submit in place of the receipt; the folded bar where the bar was |
| Kit | `packages/kit/src/review.tsx` | `ReviewSet` and `Candidate` |
| CLI | `packages/cli/src/commands/review.ts` | `mostra review export [--submission] [--format md|json] [--out <dir>]` |
| Hosts | `packages/sdk/src/mostra.ts`, `crates/mostra-host/src/{ports,mostra}.rs`, `packages/conformance/src/scenarios/review.ts` | The two ports in the SDK and the Rust crate, both reference hosts, and the scenarios `ports.reviews` and `ports.capture` |
| Server pages | `packages/themes/src/pages.ts`, `packages/runtime/src/server/pages.ts` | The wordmark and the name as a mark; the consent page's words |
| Skill | `skills/mostra/references/review.md`, `SKILL.md`, `references/answers.md` | Review sets, comments, anchor providers and `mostra review export` for agents (for Mirza's acceptance, D149) |

## Evidence

Every check runs through the real interface: a real daemon over the host protocol, `mostra` from the workspace build, and Playwright against the real gateway and shell in Chromium, Firefox and WebKit. Each row's seeds (`node packages/runtime/scripts/prove-seeds.ts --name "<name>"`) went red when planted and green when restored.

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| RV-01 | verified | Comments pin on native DOM, a canvas, a kit chart's datum, a served frame, a served frame the artifact sandboxes and an opaque frame; six pins, numbered, beside their places; a reload places them again; each arrives with the submission | e2e `review.spec.ts` "pin on DOM, canvas, a kit chart, a served frame and an opaque frame" (Chromium, Firefox, WebKit); seed "a served frame's pages carry no review agent" | passes in three engines; the seed red, then green |
| RV-02 | verified | Every stored anchor has the layers that apply (review ID, CSS and text-quote selectors, rect with viewport and DPR, the frame, the chart datum) and always a crop, captured by the verify runner (default) or the host's `capture` port, in the viewer's light or dark, its file existing; a hosted page's crop is rendered on the owner; a crop is set once; a removed hosted artifact's crops go; the layers resolve in order, each one taken away leaving the next (provider, review ID, CSS selector with its quote, quote alone, box, none); a plugin's provider is registered by the page | `packages/react` browser `anchors.test.tsx`; `plugins.test.ts` "an anchor provider a plugin carries"; e2e `review.spec.ts` (export's layers), `review-surfaces.spec.ts` (light or dark crop); `review.test.ts` "stores the crop the capture port supplies"; `hosted.test.ts` "a hosted page's comment, its crop rendered on the owner"; `operator.test.ts` "removes its comments' crops"; unit `review-threads.test.ts` (write-once triggers, pending crops); seeds "the review ID is asked before an anchor provider", "the text quote alone is never asked", "a plugin's anchor provider is never registered", "a crop is recorded without its picture", "a crop is always light", "a hosted page's crops are never rendered", "the owner keeps no copy of a hosted page's crop", "a removed hosted artifact's crops stay on disk" | all pass; each seed red, then green |
| RV-03 | verified | Gallery, focus and compare of two to four candidates, synchronized scrolling, a pixel difference (identical pixels black, differing ones not, read from the screenshot), the trusted Choose naming the candidate in view; the choice and a comment carrying its review set and candidate arrive with the submission; a Choose label past 48 characters is offered and arrives whole (#188) | e2e `review.spec.ts` "gallery, focus, synchronized compare"; `controls.spec.ts` #182 and #188 cases (390 and 320 px); seeds "a compare's candidates scroll on their own", "#188: a Choose label past 48 characters takes the Choose away" | passes in three engines; seeds red, then green |
| RV-04 | verified | A page reaching into the shell, calling its review routes, sending forged bridge messages, flooding false pin places and drawing look-alike pins and panels makes, hides and resolves nothing: the shell's pin stays on the page and on top, the panel lists the one real thread, `review/export` has it open | e2e `review.spec.ts` "reaching into the shell …" (three engines); seed "a page throws its pin off the page" | passes; the seed red, then green |
| RV-05 | verified | `mostra review export` writes Markdown and JSON naming every thread, its status, anchor layers and crop path, which exists; `--out` copies each crop beside the export | CLI `contract.test.ts` "results … review export"; `review.test.ts` (Markdown and JSON, `--out`); seed "review export --out names crops it never copied" | passes; the seed red, then green |
| SH-05 | plausible | The shell's final pass: the review overlay, review sets, the status beside Submit in place of the receipt, the folded bar where the bar was (#218), the server's name as a mark, every state photographed in light and dark at 1280 and 390 px and checked by axe with no sideways scroll | e2e `review-surfaces.spec.ts`, `surfaces.spec.ts` (`MOSTRA_E2E_SCREENS`); pictures in `docs/progress/evidence/wp-20/`; seeds "#218: the folded bar jumps …", "#118 …" (the status) | passes in three engines; Mirza's design review pending (D68) |
| SH-06 | verified | On a phone's width with touch: comment mode (its words, the peeking panel, a drag that scrolls, a tap that picks), the composer, the sheet standing above the dock and its Submit, a reply, resolve and Submit by tap, pins out of view not drawn, in Chromium, Firefox and WebKit emulation; and on Mirza's own phone (external, over a public tunnel): a comment by tap, one on selected words, an answer and Submit, all arrived with their crops, and his five notes fixed | e2e `review-surfaces.spec.ts` "390 px wide … by touch", `review.spec.ts` "comment mode on a phone"; `controls.spec.ts` (#182 at 390 and 320 px); Mirza's phone check (M101, M102) | passes in three engines; the phone check's answer and comments in `mostra results` and `review export`; seeds SH-06 red, then green |
| CO-06 | verified | An `@mention` raises exactly one `review.mentioned` per mentioned person per comment, naming the person (key, name, `ref`) for hosts, which filter it by type; pages never hear it; a key the page may not mention is refused | `review.test.ts` "shows a page only its own threads, and raises one host-only event per mention"; unit `review-threads.test.ts`; seeds "a mention raises no event", "pages hear of mentions" | passes; seeds red, then green |
| HO-11 | verified | A host's `reviews` port receives each thread, resolve, reopen and choice; its `capture` port supplies the crop a comment stores (the kept crop's SHA-256 the host's); without them nothing is mirrored and the verify runner's browser takes the crop; the SDK, the Rust crate and both reference hosts serve them | conformance `ports.reviews`, `ports.capture` (TypeScript and Rust reference hosts, standalone and broken modes); `review.test.ts`; SDK `sdk.test.ts`; seeds "the host's capture port is never asked", "the reviews port mirrors nothing" | passes; seeds red, then green |

## Issues on the milestone

| Issue | What was done | Test, and its seed |
|---|---|---|
| #188 | A Choose's label may be 256 characters; the bar shortens it, its name and title keep it whole, and results carry it | `controls.spec.ts` (#182, #188 cases); seed RV-03 "#188" |
| #218 | The folded bar stays at the top right on a computer, at the bottom on a phone | `surfaces.spec.ts` (hosted-folded); seed SH-05 "#218" |
| #152 | A page that comes up with no layout says so in `mostra/ready` (`painted: false`), and the shell enters its frame again, at most twice; found in the traces of the failed runs (a document whose root has no box after a hosted shell's page loads again) | `client.spec.ts` "whose document comes up without a layout is entered again (#152)"; seed SH-05 "#152" |
| #194, #85 | One cause, read from run 44919847696's trace: the trusted Submit judged required answers from its own stream while it lagged behind the revision the page confirmed, and refused a draft that was saved. It now reads the view's draft at that revision first | `client.spec.ts` "a trusted Submit judges the draft the page confirmed (#194, #85)"; seed IN-13 "#194, #85" |
| #167 | An operator's `policy.link` may ask for `performance: { report: true }`: the hosted shell sends one report per view (load time, errors), counted as `page.loads` and `page.errors` through `metering`, no cookie, key or address kept | `operator.test.ts` "load time and errors"; `surfaces.spec.ts`; seeds HO-09 "#167" (two) |

## Found while building

- **A frame the artifact sandboxes had no review agent.** It has an opaque origin, so its request for the agent's file carried no session and was refused; the agent is written inline into every page of the version but its entry (D183 item 7).
- **Crops showed the page light when the viewer saw it dark.** The anchor now records the viewer's light or dark, and the verify runner renders the crop in it.
- **Hosted pages' crops stayed pending forever**: a hosted home has no browser. The owner instance renders them over the relay (D183 item 4).
- **A removed hosted artifact left its crops on disk**, which show what its viewers answered; they go with it now, but for one another thread of the home still names.
- **The phone's comments sheet covered the trusted Submit**, found by the new review surfaces suite; the sheet stands above the dock.
- **A test helper matched port calls as answers**: `LineClient.call` in `packages/runtime/test/support.ts` now takes only responses, since an instance's port call can share a request's ID.
- **An import cycle** (`review.ts`, `submissions.ts`, `results.ts`), refused by dependency-cruiser: the Markdown helpers moved to `interaction/markdown.ts`.
- **The `reviews` port named a crop by a path relative to the home**, which a host can't open; it names it by its path in the home, as results do (`review.test.ts` checks the mirrored path exists).
- **Candidates side by side had no names**; each shows its name above it, but in the difference view.
- **A plugin's anchor providers reached no page**: the manifest took `contributes.anchorProviders`, and nothing loaded them. Every page now registers them before it mounts, from the build's layout (`plugins.test.ts` "an anchor provider a plugin carries": the crop of a comment named in the provider's terms alone is the provider's element; seed "a plugin's anchor provider is never registered").

## Review

One independent review of the candidate (D172 item 0), posted on #244 on 2026-11-24: 10 findings (2 P1, 3 P2, 5 P3), read from the diff. Each is fixed with a test that fails on the old code and a seed planted where the fix holds (`node packages/runtime/scripts/prove-seeds.ts --name "<name>"`: red when planted, green restored). Severities are the review's.

| Finding | Severity | What was done | Test, and its seed |
|---|---|---|---|
| 1. A link that dies while Submit waits for crops still submits | P1 | Both submits wait for the viewer's crops only when the submit would record something, then check the link again (410 `MOSTRA_HYGIENE_TOKEN_REVOKED`), then run the server's admission | `review.test.ts` "…finding 1" (a link revoked mid-wait records nothing); HY-03 seed |
| 2. Crops rendered as the owner, with the real secrets, shown to others | P1 | A crop renders as a viewer of the commenter's own (a sandbox viewer with their answers, or the owner's for the owner), with no server function run (`dryRun` refused) and no live producer started: live values are the ones the home stored. Only the commenter and the owner see a crop's picture; others see that one exists (`withheld`) | `review-threads.test.ts` "findings 2, 9"; `review.test.ts` crop-probe (a page painting what it can learn: its colour proves no server code ran and no owner view); five RV-02 seeds |
| 3. Crops starve past the 100 oldest; `settled` returns early | P2 | Pending crops are read in pages by ID; a submit's own threads go first, asked by ID | `cropper.test.ts` (150 jobs, 120 of an away owner); two RV-02 seeds |
| 4. A viewer can be blocked from submitting for good | P2 | A submission's review has a budget (8 MiB, inside the snapshot's room after the answers): the submitter's own messages and the newest 50 of others' per thread; `messagesOmitted` and `commentsOmitted` count the rest, which `review/export` still has | `review-threads.test.ts` "…finding 4"; two RV-05 seeds |
| 5. Leftover merge markers in the decision log | P2 | Removed; the repository lint now refuses conflict markers in any tracked text file | `tools/test/rules.test.ts` "conflict markers" |
| 6. A post whose answer was lost makes a second thread | P3 | The same words post with the same thread and comment IDs until one succeeds | `packages/shell/test/attempts.test.ts`; e2e `review.spec.ts` "selected words, comment mode…" (the first post's answer dropped: one thread); RV-04 seeds (unit and end to end) |
| 7. A foreign embedded frame can answer for the artifact | P3 | Only frames the version serves are asked, and only answers from the page's own origin or an opaque one (`"null"`) count | `agent.test.tsx` (a forger frame); RV-01 seed |
| 8. A hosted respondent sees "Delivered" without hosted chrome | P3 | The shell judges a hosted link by its own address too | shell model tests; by inspection |
| 9. Raw internal error text reaches pages | P3 | Pages see that a crop failed, never why; hosts and results keep the reason | `review-threads.test.ts` "findings 2, 9"; RV-02 seed |
| 10. The opaque frame's selector isn't valid CSS for what it means | P3 | A frame is named by its CSS path; older anchors' form still resolves | `agent.test.tsx`; RV-01 seed |

**Mirza's notes on the candidate (M101)**, each built and tested the same way:
- **A light crop on the dark theme:** the picture he saw predates crops following the viewer's light or dark; the new pictures show a dark crop on the dark page (`dark-390-review-thread.png`), and `review-surfaces.spec.ts` judges each crop's light or dark against what the shell showed.
- **Nothing in comment mode said what to do on a phone:** comment mode now says "Tap what you want to comment on." on a touch screen ("Click …" otherwise) at the top of the page, with Cancel, and a tap through those words still reaches the page (`dark-390-review-mode.png`); the comment button reads Cancel meanwhile. Three seeds (the words missing, the words covering the page, the offer missing).
- **Comments on selected words:** select words on the page, and a Comment button appears beside them (a page can't add to the browser's own menu, and a phone has none); the comment anchors to those words with their context and finds them again after a reload or an edit around them (`anchors.test.tsx`; e2e in three engines with a mouse selection; `light-1280-review-selection.png`, `dark-390-review-selection.png`). Two RV-02 seeds.

**Mirza's phone check (M102, external),** 2026-11-24, over a public Cloudflare tunnel from this Mac (Tailscale isn't installed here), on his own phone (a 384×609 viewport at DPR 2.81, so an Android phone): he commented on the heading by a tap in comment mode, commented on selected words of the agent's paragraph ("two of the three reviewers are travelling on Monday"), answered and submitted. Both crops were captured; the answer and both comments arrived (`mostra results`, `mostra review export`). "It looks excellent", with five things to fix, each built and tested in three engines:
- **Pins stuck to the top of the screen when their place was scrolled past:** a pin whose place is out of the page's view isn't drawn now; the panel lists the thread and the comment button counts it whatever a page reports (RV-04's test now samples a page that lies off the page). Seed RV-01.
- **A crop of selected words boxed whole lines:** the crop marks exactly the words as a selection looks (the CSS Custom Highlight API in the crop's render), with no box; `review.spec.ts` checks the crop's pixels (a highlight, none of the outline's blue), and a crop of a selection across three lines shows only those words marked. Seed RV-02.
- **Comment mode couldn't be scrolled on a phone:** a finger's drag over comment mode scrolls the page (a flick coasts), a wheel too, and only a tap picks a place (`mostra/review.scroll`). Seed SH-06.
- **Existing comments popped up over the whole screen in comment mode:** his option 1, the panel peeks: its head, the comment being written and "Comment on the whole page", on a phone the threads one tap away ("Show the N comments"); leaving comment mode takes a peeking panel with it (`light-390-review-mode.png`, `-composer.png`, `-peek.png`). Seeds SH-06.
- **A place picked with the panel closed showed nothing:** a comment being written always shows, in a panel that at least peeks. Seed SH-06.

## What CI found

- **The first full run** (45138224745): the cycle above; seeds whose anchors moved (re-anchored, re-proved); the Rust wire types; expectations of the new ports and `frame-ancestors 'self'`; the comment button's accessible name; the React size budget (the lazily loaded review agent counted with the entry).
- **The second** (45147376716): the bridge's budget; the receipt's selectors left in the release smoke script and the frozen-revision test; the Skill's anchor-provider sample, now a whole module; a Windows path in `review.test.ts`; the Rust types again; Windows arm64's `windows-conformance` past its 14 minutes, so the kit's other modes run in a group of their own (`conformance-adapters`, `windows-conformance-adapters`, REPO_STANDARDS §6).
- **The third** (45158488880): the review surfaces suite judged the trusted Submit while it was still arming (its colours fading in); it now waits for it, as a person's click must; the React budget again (69 and 46 kB).
- **The fourth** (45185569251, after merging `main`): every job green but Firefox's review surfaces in dark, on Linux, macOS and Windows: Playwright's emulated dark scheme doesn't reach the shell's page in Firefox (its `prefers-color-scheme` reads light there), so the shell was light and so was the crop. The check now compares the crop with what the shell showed; dark crops are proven in Chromium and WebKit.

- **The fifth** (45197747940): every job green after a rerun of three legs cancelled at their limits on slow runners (Windows arm64's `windows` group at its 14-minute deadline, which it neared in the run before too; macOS `rust`; darwin-arm64's release smoke), but macOS `remote-access`, which GitHub gave no runner in 15 minutes three times running, nor the `starved` job's retry (#210's class: GitHub's macOS capacity, no test ran).
- **After the review** (45371696490, 45374637752): two findings, both of this package's own. The new conflict-marker lint read a tracked link (the gates' repository copy shares `node_modules` by one) as a file: it now reads regular files only. And finding 4's test wrote its 4,800 long replies one commit each, which took Windows arm64 past the test's time: the replies beyond the first two are written in one transaction, its seeds red and green again.
- **The sixth** (45382093072, on `581d47ad`): green on every job and leg, macOS, Windows arm64 and the six-platform release rehearsal included.
- **The merge queue's first run** (45463515020): every job green but Windows arm64's emulated Chromium, third of three, which passed its tests in 17.5 minutes after 7 of setup and met the job's 25 minutes in its cleanup (and macOS `verify-failures`, which got no runner). Playwright's own split by test count had put every long suite in the last part: in four parts (45481298195, every leg green on its first attempt) the fourth still took 915 s against 341 to 545 s for the others. Each part now takes whole spec files dealt by their measured length (`tests/e2e/support/parts.ts`, longest first to the part with the least), so the four take about the same time; `tools/test/e2e-parts.test.ts` holds every spec to a length and every part to its share, with two seeds (EN-07) red, then green.
- **The run after that** (45495029498): two failures in `surfaces.spec.ts`, both waits too short for a page of another origin. On Windows arm64's emulated Chromium, `surfaces.spec.ts` now ran first on its part, against a cold server, and the API origin's sign-in page took 5.6 s to arrive against a check's default 5 s; on Linux WebKit, a picture of the device page was taken while the "Refuse" form was still loading the next page ("Execution context was destroyed"). The checks after each navigation to the API origin now wait 20 s, and each picture after a click that loads a page waits for that page's `load` (three steps); the spec passes in Chromium and WebKit.

## Deviations

- **Candidates that are other versions or artifacts** (ROUND-3 §2's `<Candidate artifact version>`, shown in sibling frames) aren't built: RV-03's check names surfaces within one artifact, and another artifact's frame needs a capability the page's link doesn't hold. A later package can add them to the same `ReviewSet` additively.
- **Pixel difference** is drawn by the browser over the live candidates (`mix-blend-mode: difference`), not computed from screenshots: it follows the page as the viewer scrolls and works for any content; the test reads its pixels.
- **Artifact pages may frame each other** (`frame-ancestors 'self' <shell>`), amending D98 item 4, for served frames (D183 item 7).
- **Size budgets** raised: `@mostra/protocol` 70 to 76 kB and its bridge 7.5 to 8.5 kB; `@mostra/react` 63 to 70 kB with Zod and 40 to 47 kB without (D183 item 16).
- **WP-34's planned ledger migration is 21**; 20 is this package's.
- **D182 was MT-07's** by the time this package merged `main`: this package's decision is D183, its source message M100.

## Untested boundaries

- **The tailnet path to a phone** (SH-06, external): Mirza's phone check ran over a public Cloudflare tunnel, since Tailscale isn't installed on this Mac; the tailnet share's own path is proven by WP-13's suites and its stand-ins.
- **Real Safari**: WebKit only.
- **A host-supplied shell** answering the review bridge messages: the conformance scenarios run against Mostra's shell.
- **Anchor providers from a real plugin on npm**: a plugin's providers are proven from the suites' local registry (`plugins.test.ts`); WP-25 packages the chart datum provider as a plugin.
- **Hundreds of threads on one page**: tested with six pins; tracking is throttled to one report per animation frame and capped at `REVIEW_TRACK_MAX`.
- **Dark crops in Firefox**: the e2e browser's emulated dark scheme doesn't reach the shell in Firefox, so Firefox's dark runs show and crop the page light; dark crops are proven in Chromium and WebKit.
- **Screen readers**: axe passes on every review state; no VoiceOver pass.

## For Mirza

- **Design review (SH-05, D68):** the pictures in [evidence/wp-20/](evidence/wp-20/): every review state in light at 1280 px and dark at 390 px, review sets, the status beside Submit, the folded bar, and the server's sign-in and consent pages.
- **Words (D149):** `REVIEW_WORDS` and `DELIVERY_WORDS` in `packages/shell/src/words.ts`, `STATUS_WORDS`' new states, the consent page's "An app calling itself …" (`API_PAGE_WORDS.selfNamed`), the `REVIEW` diagnostics' hints, `mostra review export`'s help, and the Skill's `references/review.md` and its rows in `SKILL.md` and `answers.md`.
