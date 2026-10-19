---
code: MOSTRA_ENV_BROWSER_MISSING
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ENV_BROWSER_MISSING

Browser for verify missing. Severity: error. Phase: host.

## What it means

Verify renders pages in the Chromium headless shell its Playwright release pins. The runtime bundle fetches that browser when it is set up and checks every file of it (D142). It wasn't there, so verify ran only the stages that need no browser (type check, build and the field-ID scan) and reported this error. Publishing needs `--force` until it is installed.

## How to fix it

Run `bin/mostra-setup` in the runtime bundle's directory (the message names it) with network access; it fetches and checks the pinned browser. Outside a bundle, in a development checkout, run `npx playwright-core install chromium-headless-shell`. Then verify again.

## Hint

Run the runtime bundle's `bin/mostra-setup` (with network access) to fetch the browser verify uses, then verify again.
