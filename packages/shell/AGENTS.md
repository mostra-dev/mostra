# @mostra/shell

Audience: runtime bundle. Runs in: browser. May import: @mostra/protocol (tools/package-map.ts).

## Purpose

The shell: the trusted page on the shell origin that hosts an artifact's frame (ARCHITECTURE §5).
It is a Vite-built React app that the runtime's gateway (`packages/runtime/src/gateway`) serves
from `dist/`, found beside the runtime package or through `MOSTRA_SHELL_DIR`.

## Invariants it owns

- **Trusted controls render only here (SH-01, invariant 7).** Anything a person must be able to
  trust (Submit, Choose, the version banner, the review overlay) is shell DOM, never frame DOM.
  The frame can only ask for it over the bridge.
- **The token leaves the address bar first.** `open()` reads `#t=` and calls
  `history.replaceState` before any request (D97).
- **The bridge talks to one window at one origin.** `connectBridge` gets the frame's
  `contentWindow` and the artifact origin from the ticket answer; nothing else is accepted
  (SH-04).
- **Same-origin only.** The gateway serves this page with a `'self'`-only Content-Security-Policy
  and `frame-ancestors 'none'`. Keep the build free of inline scripts and styles and of every
  third-party URL.

## Public interface

None: the package publishes `dist/` for the runtime bundle. `src/main.tsx` is the entry,
`src/shell.tsx` the page, `src/api.ts` its calls to the gateway (session, ticket).

## Tests to run

`pnpm --filter @mostra/shell test` (location parsing and messages), then the gateway suites:
`pnpm --filter @mostra/runtime test:integration` and `pnpm --filter @mostra/e2e e2e` (Chromium,
Firefox and WebKit). Rebuild the shell after a change: the gateway serves `dist/`.

## Gotchas

- `<html data-shell>` is `loading`, `framed`, `initialized`, `ready` or `error` (with
  `data-shell-error`); end-to-end suites wait on it instead of sleeping.
- The look is a placeholder until WP-20's design pass (D68); keep it quiet.
