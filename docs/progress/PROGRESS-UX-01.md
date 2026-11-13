# UX-01 progress: every surface a person meets, from sign-in to answer

**Status:** Candidate; Mirza approved merging and closing out once every check is green (2026-11-13T18:27Z). A design unit (it owns no requirement) over every page the open server draws outside an artifact: the API origin's pages, the hosted shell's trusted chrome and the pages a link can end on ([specification](../design/work-packages/UX-01.md)). The same session builds the operating layer's own surfaces outside this repository on this package's published themes; nothing of that half enters this report.

## Baseline

| | |
|---|---|
| Branch | `ux/01-surfaces`, created from `origin/main` |
| Starting `HEAD` | `f646253` (`origin/main`, 2026-11-13: "docs: MT-03's closeout, Mostra 0.13.0, WP-16 next (#149)") |
| `git status` | clean |
| `pnpm check` | on `f646253` in a detached worktree on the external disk (`/Volumes/Active/mostra-ux-01/.baseline/mostra`), after a fresh `pnpm install --frozen-lockfile`, 66 min 51 s while another repository's integration suites ran beside it: every job passed (format-lint, types, hygiene, e2e, build, boundaries, api, licenses, rust, conformance, docs, commits) but `unit` and `integration`. `unit` failed cases on their time limits under the load (`@mostra/protocol` `ids.test.ts` and `serializer.test.ts`, `@mostra/mcp` `server.test.ts`, `@mostra/react` `seams.test.ts`, `@mostra/runtime` `gc.test.ts` and `interaction.test.ts`'s properties, `@mostra/worker` `index.test.ts`, `create-mostra` `run.test.ts`, `@mostra/tools` `gates.test.ts`), and `integration` one case of `operator.test.ts` (a share refused while the operator hangs). Every one of those files then passed alone at once (92, 15, 3, 46, 9, 4, 29 and 19 tests). The class MT-02, WP-30 and MT-03 recorded; the baseline is green |
| Predecessors | WP-31 done ([PROGRESS-WP-31](PROGRESS-WP-31.md)) and MT-03 done ([PROGRESS-MT-03](PROGRESS-MT-03.md)), both on `origin/main`; no `RECOVERY-UX-01-*.md` |
| Local toolchain | Node 24.22.1 (`.node-version`), pnpm 12.14.0, macOS 26.2 arm64 |

## Decisions with Mirza

- **2026-11-13T11:51Z**, his answers to the session's first questions: a themes package rather than a one-purpose stylesheet, built to last ("robust, high-quality, modular, future-proof"), which everything that uses the themes adopts; dark mode following the system with a switch for a person's own choice; the operating layer's dashboard built now on the Skill's Studio stylesheet and Base UI parts, its later move to the kit noted for WP-18; the open runtime's requests that are close to this package taken in it; dates are his, not this package's. Brand or Studio, and the open server's name under a self-hoster, were shown to him as screenshots for his choice.

- **2026-11-13T12:31Z (M68)** and **13:23Z (M69)**: how much of Mostra each surface shows, Studio with more soul, the made-with mark always on for free-terms pages (self-hosted included), the hosted chrome with fewer words, buttons for the viewer, a status beside Submit and a fold, one small light-or-dark button; Mostra's marks in the themes package. Recorded as **D171** with M67 to M69.
- **2026-11-13T18:27Z**: merge and close out once everything is ready, without stopping to ask.

## What was built

| Part | Where | What it does |
|---|---|---|
| `@mostra/themes` | `packages/themes` | Mostra's themes as data (`studio`, `mostra`; light and dark), refused by `defineTheme` below WCAG 2.2 AA or out of gamut; their stylesheets; Figtree, Jost and Spline Sans Mono (OFL 1.1); `createPages` (task, notice and workspace layouts, no script, one stylesheet from the page's own origin, every string as text, the one-button appearance switch, "Runs on Mostra" on every server not dressed as Mostra); `renderMail` (HTML with a plain text that carries the whole message); `tailwindStylesheet`, which generates the Skill's Studio stylesheet |
| The server's own pages | `packages/runtime/src/server/pages.ts`, `authorize.ts`, `api.ts`, `gateway/theme.ts` | Sign-in, the development provider's name page, linking a machine (each state), a chat app's consent (registered, metadata-document, loopback), "Answer as yourself", "Sign-in can't continue", and every refused navigation (an unknown host's 421, a suspended or moving home, an expired link) in the operator's theme and name, their files at `/_mostra/theme/*`; the configuration key `appearance` (INTERFACES §18.1) |
| The shell's chrome | `packages/shell/src/chrome.tsx`, `viewer.tsx`, `shell.css`, `icons.tsx`, `appearance.ts`, `words.ts` | One bar (title, sender with its verifier, the viewer's pill buttons, a status beside Submit in shape and colour, a fold), a footer (passwords, Report, the made-with mark, light or dark), a native report dialog; on a phone Submit at the bottom and the viewer's choices in a sheet; folded, only the status and the way back; the shell's own notice pages as cards |
| The surfaces suite | `tests/e2e/specs/surfaces.spec.ts`, `fixtures/surfaces*` | Every surface and state in Chromium, Firefox and WebKit, 1280 and 390 px, light and dark, each checked by axe (no serious or critical finding) and for sideways scrolling, photographed with `MOSTRA_E2E_SCREENS`; a keyboard-only pass |
| Seeds | `packages/runtime/scripts/prove-seeds.ts` | Four UX-01 seeds; HY-08's and HY-09's chrome seeds re-anchored |

## Evidence

A design unit owns no requirement (D152, as a maintenance unit): one row per item of the specification's acceptance evidence, each checked through the real interface (a real `mostra-runtime server`, real owner daemons, real browsers through the real front and gateway, the fixture operator module).

| Item | State | Check | Command | Result |
|---|---|---|---|---|
| 1. Every surface and state photographed in three engines, two widths, both modes | validated | 36 surfaces per engine, mode and width: the API origin's 11 pages and states, the hosted chrome's 13 states, 6 pages a link ends on, the local shell's 2 (378 pictures); contact sheets committed as the after baselines, the 0.11.0 pictures as the before ones | `MOSTRA_E2E_SCREENS=<dir> pnpm --filter @mostra/e2e e2e specs/surfaces.spec.ts` | 12 of 12 runs pass (Chromium, Firefox, WebKit on macOS 26.2); `docs/progress/evidence/ux-01/` |
| 2. axe: no serious or critical finding on any surface | validated | axe-core 4.14.0 on the shell's own document (the artifact's frame is the author's) and every server page, after every state change; the suite fails naming each finding. Found and fixed on the way: a made-with link whose name didn't contain its words (2.5.3), Submit measured mid-arming, a scrolling reason a keyboard couldn't reach (2.1.1) | the same suite | 0 findings in 12 runs |
| 3. Keyboard-only pass on sign-in and Submit; focus visible | validated | From the hosted chrome by Tab alone: Sign in, the provider, the name, Continue, back to the page, the answer, the trusted Submit; every stop's focus outline visible; the fold returns the focus | `… -g "keyboard only"` | 3 of 3 engines pass |
| 4. Screen-reader pass | unverified | Not run: needs VoiceOver driven by a person. The chrome's names, roles and live regions are axe-checked (item 2) | – | Boundary below |
| 5. Contrast AA in every mode | validated | `defineTheme` refuses any theme whose text pairs fall below 4.5:1 or whose control edges and rings fall below 3:1 (unit, seeded with a failing theme); axe's colour-contrast on every rendered surface in light and dark | `pnpm --filter @mostra/themes test`; item 2 | 20 of 20; 0 findings |
| 6. Reduced motion honoured | validated | Every transition and the press scale fall back to colour and opacity under `prefers-reduced-motion`; the suite renders with reduced motion | `shell.css`, `PAGE_CSS`; item 1 | inspected and rendered |
| 7. Long and hostile content | validated | A right-to-left viewer name, an unbreakable 105-character title, an operator's 1,000-character interstitial message with a right-to-left run, a 500-character pause reason and footer, hostile names in every API page (escaped, no tag or handler survives); none scrolls sideways | item 1; `vitest --project unit server-pages.test.ts` | pass |
| 8. The rules the surfaces keep | validated | The forgery suite and the hosted rules unchanged and green; the server's pages run no script, carry no inline style, load only their own origin's files; the appearance cookie is set only by its own origin's form and returns only to its own paths; every server not dressed as Mostra says "Runs on Mostra"; refused navigations say the shell's own words | every e2e spec in three engines; `vitest --project integration server-pages.test.ts oauth.test.ts signin.test.ts binding.test.ts operator.test.ts hosted-rules.test.ts signin-facts.test.ts`; hygiene; `prove-seeds.ts --only UX-01`, `--only HY-08`, `--only HY-09` | 207 e2e pass; 7 + 52 integration and 38 hygiene pass; 4 UX-01 seeds and the 2 re-anchored chrome seeds red, then green |
| 9. A real phone over the tailnet (external) | blocked | Needs Mirza's phone | – | Boundary below |
| 10. Every existing suite green with `ci:full` | (CI) | `ci:full` on #150 | GitHub Actions | Filled in when the run ends |

## Untested boundaries

- **A screen reader** (VoiceOver on macOS and iOS) was not run; every name, role and live region is axe-checked.
- **A real phone over the tailnet** waits for Mirza's phone.
- **Windows** runs the surfaces suite in its Chromium and Firefox legs in CI; it was written and run locally on macOS.

## Agent-facing and viewer-facing words for review (D149)

- The hosted chrome's words (`packages/shell/src/words.ts`: `STATUS_WORDS`, `CHROME_WORDS`, `HOSTED_WORDS`' new and changed lines: "Report", "Make pages like this", "Shown to the person who sent this page, as not verified.").
- The API origin's pages (`packages/runtime/src/server/pages.ts`, `API_PAGE_WORDS`): "Link this machine", "The code that machine shows", the device warning, "Allow <app>?", the grants list, "Choose how to sign in.", "You sign in with your provider. This server never sees your password."
- The refusal pages' words (`PAGE_REFUSALS`), equal to the shell's, and "There's no page here" for an unknown host.
- The themes' own words (`PAGE_WORDS`): "Runs on Mostra", "Make pages like this", "Switch to dark", "Switch to light", "Skip to the page", "Sections".
- `packages/themes/AGENTS.md`, `packages/shell/AGENTS.md`; the self-hosting page's `appearance` row.
