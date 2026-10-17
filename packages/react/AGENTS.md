# @mostra/react

Audience: artifact authors (browser). Runs in: the browser, compiled into every version. May import:
`@mostra/protocol`, `react`, `react-dom`, `react-router` and `react-hook-form` (the last two as
optional peers, only from `./router` and `./form`; tools/package-map.ts).

## Purpose

The client runtime artifact authors import (INTERFACES §2.3): `defineArtifact`; `useField`,
`useSubmit`, `useSubmitControl`, `useSignal`, `useChoice`, `useViewer`, `useArtifact`;
`window.storage` (D53, D112); `openLink`; `@mostra/react/form` (react-hook-form, D52) and
`@mostra/react/router` (`pages/`, D57). It also holds what the builder's generated entry calls
(`mountArtifact`, `mountRoutes`) and `createServerReference`; and, since WP-08, `useAction`,
`useLive` and the transport that makes server references reach a worker (`setServerCallback`).

## How it works

- `src/runtime/boot.ts` starts one runtime per page: inside Mostra's shell it connects the bridge
  (`src/shell-bridge.ts`), learns its view from `ui/initialize`'s answer, and starts a live
  `Store`; anywhere else (a static export, the page opened on its own, a page whose build isn't
  its view's version, D115) the store is local and saves nothing to Mostra.
- `src/runtime/store.ts` is the one owner of field state on the page: what the server holds per
  field and revision, optimistic edits, the debounce, the mutation queue, conflicts, refusals,
  registrations and blockers, submissions and their deliveries. Hooks read it through
  `useSyncExternalStore`.
- `src/runtime/journal.ts` writes every edit to IndexedDB before it is sent; `transport.ts` speaks
  the browser protocol (`fields`, `submit`, `signal`, `call`, `runs`, `live`, the event stream with
  its long-poll fallback).
- `src/runtime/server-client.ts` (the store's `server`) owns the page's runs and live sources:
  one record per run and per key however many hooks show it, fed by the stream's ephemeral
  messages and read again after a gap or a reconnect; `src/server-hooks.ts` holds `useAction` and
  `useLive` over it.

## Invariants it owns

- **No saved input is lost (IN-02, IN-04).** An edit is journaled before it is sent, keeps the
  base revision it was made on, and leaves the journal only when the gateway answered it. Blur,
  `visibilitychange`, `pagehide` and every submit flush; a closing page sends with `keepalive`. The
  next page replays what closed tabs left, in order, each with its own mutation ID and view.
- **Nothing is overwritten silently (IN-03).** A field changed elsewhere since the viewer's edit is
  a conflict with both values; only `keepMine` or `takeTheirs` ends it. BroadcastChannel only cuts
  latency; the event stream is the truth.
- **A submission holds what the viewer saw (D110).** Before any submit the store writes the
  defaults of mounted, never-stored viewer fields and flushes; blockers come from the mounted
  fields' `required`, validation and conflicts.
- **The artifact never forges the trusted controls (SH-02).** It asks for them over the bridge
  (`mostra/controls.request`); the shell renders and runs them. Where the view's policy denies the
  artifact channel, `submit()` and `choose()` reject with `MOSTRA_SUBMIT_CHANNEL_DENIED` before any
  request.
- **`defineArtifact` is the identity function.** Mostra reads the manifest statically and never runs
  it (D51), so the function may only type-check and return its argument.
- **Client-only and environment-free (D19 seam 4).** No Node built-ins, no module-level singletons
  that assume a browser global at import time, no import of server code. Size-limit gates the entry.
- **A run happens once (AC-03, D130).** A hook's second call joins its in-flight run, a key joins the
  one run of that key everywhere, and a start the network lost is retried with the same client
  key. A final run state never goes back.
- **Live values only move forward.** A revision older than the one shown never replaces it; a
  producer's error keeps the last good value.
- **A server reference without a transport fails loudly.** It rejects with
  `MOSTRA_TARGET_UNAVAILABLE`; it never resolves with a made-up result.

## Public interface

`src/index.ts`, `src/form.ts` (`./form`) and `src/router.ts` (`./router`); the API report is
`etc/react.api.md`. `createServerReference`, `mountArtifact` and `mountRoutes` are public because
compiled versions import them, but artifact code never calls them.

## Tests to run

`pnpm --filter @mostra/react test` runs two Vitest projects: `unit` (Node: the store against
`test/fake-gateway.ts`, and the types through `expectTypeOf` and `@ts-expect-error`) and `browser`
(headless Chromium through Playwright: every hook, `window.storage` and the form adapter in a real
React DOM). Install the browser once with `pnpm --filter @mostra/react exec playwright install
--only-shell chromium`. The end-to-end suites (`tests/e2e/specs/client.spec.ts`, `controls.spec.ts`,
`versions.spec.ts`, `pages.spec.ts`) run it in three engines through the real gateway and shell, and
`packages/runtime/test/integration/browser-revisions.test.ts` runs frozen builds of earlier releases
against today's gateway. Rebuild after a change: versions link the built `dist/`.

## Gotchas

- Every published version embeds the copy it was built with and never changes, so what this
  package says to the gateway must stay compatible across releases (the browser protocol, VR-10).
  A change the gateway must understand differently is a new browser-protocol revision with its own
  frozen fixture (`node --conditions=@mostra/source packages/runtime/scripts/freeze-browser-revision.ts`).
- Import protocol values (not types) only with care: the diagnostic catalog would land in every
  artifact's bundle. The bridge's schemas are the reason for the size budget.
- The `browser` project needs a browser; the CI `unit` job installs Chromium's headless shell.
