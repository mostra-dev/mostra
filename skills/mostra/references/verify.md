# Verify: the verdict, screenshots and the dev preview

## Contents

- What verify does
- Reading the verdict
- Errors, warnings and hints
- Screenshots and the ARIA snapshot
- Regressions between versions
- Publish and verify
- The dev preview: `mostra dev`

## What verify does

`mostra verify <dir>` checks the artifact's current source without publishing it, in a sandbox that touches no one's answers and calls no host:

1. **prepare** and **compile**: reads the manifest, resolves and installs packages, type-checks (TypeScript in strict mode, or with the artifact's own `tsconfig.json` settings), builds.
2. **boot** and **render**: opens the page in a headless Chromium at 1280 × 800 and 390 × 844, with a fixed clock and reduced motion, waits until it's still (and until the calls, runs and live values it loads at mount have arrived), records page errors, console errors and failed requests, runs axe, takes an ARIA snapshot and a screenshot per size.
3. **smoke**: clicks and types through the page's controls (up to 200 interactions or 60 s), checking that each does something and that nothing breaks. Server functions run only when they opt in through `dryRun()` ([server.md](server.md)); live sources run for real, and secrets resolve as they would.
4. **regression**: compares with the last published version that passed ([below](#regressions-between-versions)).

It takes 10 to 30 s.

## Reading the verdict

The human output prints `verify: pass` or `verify: fail`, each diagnostic with its hint, and the screenshots worth looking at. Exit code 0 is pass, 1 is fail. With `--json`, the result is:

```json
{
  "status": "pass",
  "artifact": { "id": "art_…", "path": "…", "sourceDigest": "…", "envDigest": "…", "versionId": "ver_…" },
  "diagnostics": [{ "code": "MOSTRA_…", "severity": "error", "message": "…", "hint": "…", "location": { "file": "index.tsx", "line": 12, "column": 7 }, "docs": "…" }],
  "screenshots": [{ "viewport": "desktop", "path": "…/desktop.png", "width": 1280, "height": 800, "tokensEstimate": { "claude": 1334, "gpt": 1200, "gemini": 1120 }, "returned": false }],
  "aria": [{ "viewport": "desktop", "path": "…/desktop.aria.yml", "summary": "3 headings, 1 button, 1 textbox, landmarks: main" }],
  "smoke": { "interactions": 3, "skippedActions": [], "stateChanges": 3 },
  "regressions": {},
  "timingsMs": { "build": 36, "typecheck": 538, "render": 9548, "smoke": 2492, "total": 13898 }
}
```

`status` is `fail` exactly when there is an error. Diagnostics come errors first; identical ones fold into one with a `count`. `mostra docs <CODE>` prints any code's page with an example fix.

## Errors, warnings and hints

| Severity | Means | Examples |
|---|---|---|
| error | Something is definitely broken; publish refuses it | type and build errors, uncaught page errors, console errors, failed requests to the page's own origin, a blank page, a page that never gets ready, duplicate or unstable field IDs, a manifest that can't be read |
| warning | Worth checking; publish allows it | axe's serious findings, failed requests to other sites, a failing live source, a package without types, a secret the page needed that isn't set, every regression, a control with no visible effect |
| hint | Information | an input not bound to a field (`MOSTRA_FIELD_UNBOUND`, fine for a search box or a draft you don't want saved), an action skipped in verify, axe's minor findings, the smoke test's budget, no baseline yet |

Warnings that begin with **"Observed only"** (`MOSTRA_SMOKE_NO_EFFECT`, `MOSTRA_REGRESSION_*`) report what verify saw, such as a button whose click changed nothing visible or a page that changed since the last version. Look at the screenshot and decide; when the behavior is what you intended, change nothing.

Fix errors at their location, run verify again, and repeat until it passes. Fix the first error first: later ones are often its consequences.

## Screenshots and the ARIA snapshot

Screenshots are always taken. `--screenshots on-failure` (the default) marks them `returned` only when verify fails; `always` marks them every time; `never` never does. The human output lists the returned ones. **Look at them before you publish**, on every round: verify can't tell you that the page looks wrong, only that it works. The design checks in [design.md](design.md#reading-your-screenshots) say what to look for.

The ARIA snapshot (`.aria.yml`) is the page as a screen reader sees it: headings, buttons, inputs and their names. Read it when you can't look at images: it shows what text and controls the page actually rendered.

## Regressions between versions

From the second version on, verify renders the last published version that passed, in the same run, and compares: the ARIA snapshot, the pixels at each size, and the contract (fields, actions, live sources and pages that disappeared). A field you removed leaves people's answers behind, so `MOSTRA_REGRESSION_FIELD_REMOVED` is worth a second look; a layout change you made on purpose is expected.

## Publish and verify

`mostra publish` reuses the verdict of the same source, or runs verify itself. It refuses a source whose verdict has errors (`MOSTRA_PUBLISH_VERIFY_FAILED`). `--force` publishes anyway and records the failing codes on the version; it never publishes a source that didn't build. Use it only when you know why the error doesn't matter. When the headless browser isn't available (`MOSTRA_ENV_BROWSER_MISSING`), verify still type-checks and builds, and the code's page says how to install the browser.

## The dev preview: `mostra dev`

`mostra dev <dir>` serves the unpublished source with hot reload on this machine until Ctrl-C, and prints a link. Edits appear in the browser as you save; changed server code restarts its worker. Answers and submissions there go to a scratch store that's thrown away, and actions run for real with the real secrets. Nobody but you sees it: use it while building, then verify and publish.
