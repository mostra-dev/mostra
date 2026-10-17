# @mostra/verify

Audience: runtime bundle. Runs in: node, as the verify runner child (`mostra-verify`, ARCHITECTURE §1). May import: `@mostra/protocol`, `playwright-core`, `axe-core`, `pixelmatch`, `pngjs` (tools/package-map.ts).

## Purpose

Renders artifact pages in one warm Chromium headless shell and reports what it saw: errors, console and network findings, axe results, the ARIA snapshot, DPR-1 screenshots, the field probe and the smoke test. The supervisor's `verify` module (`packages/runtime/src/verify/`) owns the pipeline, the sandbox the pages are served from, and the verdict. This package only looks at pages and compares pictures, over `VERIFY_RUNNER_METHODS` (`verify/render`, `verify/compare`).

## Invariants it owns

- **Judgement follows D72 and D138 item 3.** Definite failures are errors. Smoke observations are warnings that start with "Observed:" and say what was seen. `observe.ts` (`judge`) is the one place a recorded page entry becomes a diagnostic.
- **verify's own refusal is never the artifact's fault** (D138 item 2). A rejection carrying `MOSTRA_VERIFY_ACTION_SKIPPED` is dropped, and a fault whose cause chain holds it is a hint. A console error is excused by its moment only during an interaction that produced a skip, never for a whole load. The recorder (`recorder.ts`) runs before the page's own scripts and keeps `code` and `cause` chains; a page in the verify target reports its error boundaries' catches to it (`VERIFY_REPORT`), so they are judged by cause, never by the console.
- **Renders are deterministic** (D138 item 4): one fixed `Date` per run, `reducedMotion: "reduce"`, `document.fonts.ready`, animations off and the caret hidden in screenshots, DPR 1. Readiness is the shell's `data-shell` marker and quiescence (EVAL-01b), which includes the server work the page waits on (the field probe's `pending`: calls, runs, first live values).
- **A render ends by its deadline.** One that is still running 1 s past it is abandoned: its context is closed, which ends a page that blocks its own main thread, and other runs' pages in the same browser carry on. The smoke test stops 5 s before the deadline, leaving the regression stage its time; stopping there is the budget's hint, never a timeout.
- **Each render gets a fresh browser context**, so sessions, storage and cookies stay with their render. The runner returns ARIA text and never writes it: the supervisor writes every snapshot through the instance's redactor.
- **The smoke test stays on the page**: it uses links to the artifact's own origin only, skips new tabs and downloads, and reports a control with no effect only after a second try.

## Public interface

`src/index.ts` (the runner, `judge`, `dedupe`, `compareImages`, `uniform`, `recorder`); the child's entry is `src/main.ts`. The API report is `etc/verify.api.md`.

## Tests to run

`pnpm --filter @mostra/verify test` covers the judgements, the pixel comparison and the ARIA summary. Behaviour on real pages is proven through a daemon in `packages/runtime`: `pnpm --filter @mostra/runtime test:integration -- verify audit`.

## Gotchas

- Functions passed to `page.evaluate` or `addInitScript` run in the page: they close over nothing from the module, and their files carry `/// <reference lib="dom" />`.
- The runner drives Chromium only (ROUND-3 §9), the headless shell revision `playwright-core` 1.64.0 pins. `MOSTRA_ENV_BROWSER_MISSING` means that revision isn't installed where `PLAYWRIGHT_BROWSERS_PATH` points.
- The child exits after 10 idle minutes and when its IPC channel closes, taking its process group (the browser) with it.
