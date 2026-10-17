---
code: MOSTRA_ENV_BROWSER_MISSING
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ENV_BROWSER_MISSING

Browser for verify missing. Severity: error. Phase: host.

## What it means

Verify renders pages in Playwright's Chromium headless shell, which the runtime bundle includes. It wasn't found, so verify ran only the stages that need no browser (type check, build and the field-ID scan) and reported this error. Publishing needs `--force` until it is installed.

## How to fix it

Run `npx playwright-core install chromium-headless-shell`, or reinstall Mostra's runtime, then verify again.

## Hint

Install the browser verify uses with `npx playwright-core install chromium-headless-shell`, then verify again.
