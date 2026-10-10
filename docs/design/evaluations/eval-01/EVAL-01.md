# EVAL-01: default shadcn base, Base UI vs Radix

**Question** (D27, D34). Does an agent produce working shadcn-based pages more often on the first pass with the Base UI base or the Radix base?

**Answer.** No measurable difference for GPT-6.1-Sol. Both bases passed 17 of 20 tasks on the first pass, or 17 of 18 after excluding tasks that can't be scored. There was not a single cross-base type error in 40 runs. The evidence leaves the default to secondary factors, which favor Base UI (D72).

| | |
|---|---|
| Date | 2026-10-10, 11:22 to 14:24 UTC |
| Provider and model | OpenAI GPT-6.1-Sol, reasoning effort high, through Codex CLI 0.154.0 signed in with ChatGPT OAuth (D34, D64) |
| Batches | a 1-call pilot, then prompt pairs (one run per base at once), stopped at an announced 5M-token envelope and then completed to repetition 1 as announced |
| Runs | 20 prompts × 2 bases × 1 repetition = 40 runs, plus 7 repair turns |
| Tokens | 8,604,155 in total: 8,003,540 input (6,704,768 of them cached) and 600,615 output (47,325 reasoning). No usage-limit error occurred |
| Harness and data | [harness/](harness/), [data/results.ndjson](data/results.ndjson), [data/rescore.ndjson](data/rescore.ndjson) |

## Method

- **Templates.** `shadcn@4.21.4 init -t vite -b <radix|base> -p nova` plus `add --all` (61 components, React 19.3, Vite 8, Tailwind 4, TypeScript 6.0). The Base UI template's `scroll-area.tsx` failed `tsc` out of the box, so it was fixed before any run (VERIFIED_FACTS). Both templates type-checked and built clean.
- **Prompts.** [harness/prompts.json](harness/prompts.json): 20 application pages that need composition-heavy components (dialogs, menus, popovers, tooltips, tabs, sheets, drawers, comboboxes, context menus, forms, tables and charts). The prompts are identical for both bases and never name the base or the idiom.
- **Agent instructions.** A short project note (no base hints), and the rule "write the code only; a separate checker builds it". One optional repair turn received the checker's verdict.
- **Checker** ([harness/check.mjs](harness/check.mjs)):
  - `tsc -b` and `vite build`;
  - render in headless Chromium, with page and console errors;
  - an interaction sweep that clicks or hovers every trigger-like element and requires something to open or change;
  - counts of cross-base idioms in the agent's code.
- **Calibration.** Control pages with the right and the wrong idiom for each base gave the expected verdicts in both directions. Two checker artifacts found during the run were fixed, and the controls re-passed:
  - an already-active tab counted as dead;
  - hover-only tooltips and hover cards were clicked with too short a wait.
- **Scoring.** Every run was re-scored with the final checker, from snapshots of its turn-1 code ([harness/rescore.py](harness/rescore.py)).

## Results

| | Base UI | Radix |
|---|---|---|
| First pass, all runs | 17/20 | 17/20 |
| First pass, scoreable runs | 17/18 | 17/18 |
| After the optional repair turn | 19/20 | 18/20 |
| Cross-base type errors | 0 | 0 |
| Correct base idiom uses in agent code (`render=` / `asChild`) | 21 `render=` | 55 `asChild` |
| Median tokens, turn 1 | 196,962 | 164,795 |
| Median wall time, turn 1 | 340 s | 357 s |

**First-pass failures and exclusions:**

| Run | Cause | Counted |
|---|---|---|
| base p00 | Flagged by the pre-fix checker (active tab). Its turn-1 code was overwritten by the repair, so it can't be re-scored | excluded |
| base p15, radix p15 | The template lacked `react-hook-form` and `@hookform/resolvers`, and the agent was told not to install. An environment confound common to both bases | excluded |
| radix p19 | Dropdown trigger reported dead in valid-looking code; most likely the checker (intercepted or off-screen click) | inconclusive, counted as a failure in "all runs" |
| radix p11 | Syntax error (TS1005) | failure |
| base p16 | Unclosed `<br>` in JSX (TS17008) | failure |

The real failures were generic JSX and TypeScript slips, distributed evenly, and none involved the base.

## What this means for Mostra

1. **Default base.** The data doesn't separate the bases, so the secondary factors decide, and all of them favor Base UI:
   - it has been shadcn's own default since July 2026, along with its docs, Skills and `llms.txt`;
   - new shadcn projects pick it 2 to 1;
   - the model used `render=` correctly every time, so Radix's longer training history gave no measurable edge.

   Radix stays fully supported (D27). **Recorded as D72.**
2. **False positives are harmful, not just noisy.** Three repair turns were triggered by known checker artifacts (base p00, radix p01, base p06). In two of them the agent broke working code chasing the false report: a tooltip that stopped showing, and an accordion that stopped opening. Consequence for `verify` (ARCHITECTURE §12, INTERFACES §13): smoke-test findings without a runtime error are **warnings** that describe what was observed. Only definite failures are errors: type and build errors, page and console errors, failed requests, React error boundaries. Hover-opened and already-active controls are classified before being judged.
3. **The warm set must cover what agents reach for.** Both agents asked for a validated form (p15) imported `react-hook-form` and `@hookform/resolvers/zod`, as their prompt implied. The warm set (D65) gains `@hookform/resolvers`, and `verify` turns a missing import into `MOSTRA_DEP_*` with the fix (D43).
4. **Cost.** The median first-pass task cost was about 165k to 200k tokens (roughly 85% of it cached input) and 5 to 6 minutes. This calibrates WP-27's suite and pacing.

## Limits

- One model family (GPT-6.1-Sol), one repetition and 20 prompts. The design rules ask for variety (D34). Claude Sonnet 5.5 and Opus 5.5 runs would test whether the result holds for other models; they need Mirza's approval and are proposed in the design presentation.
- Each page was built from scratch in a template with the components pre-installed, not inside Mostra's own runtime. Mostra's kit resolution and lint will differ, and WP-27 re-runs the comparison on the real toolchain.
- The interaction sweep is a heuristic. Its known artifacts are documented above and in the harness.

**Overturn condition for D72.** A later evaluation shows a first-pass gap of 10 points or more in Radix's favor on any model in the D34 mix.
