# @mostra/shell

Audience: runtime bundle. Runs in: browser. May import: @mostra/protocol (tools/package-map.ts).

## Purpose

The shell: the trusted page on the shell origin that hosts an artifact's frame (ARCHITECTURE §5).
It is a Vite-built React app that the runtime's gateway (`packages/runtime/src/gateway`) serves
from `dist/`, found beside the runtime package or through `MOSTRA_SHELL_DIR`.

## Invariants it owns

- **Trusted controls render only here (SH-01, invariant 7).** Anything a person must be able to
  trust (Submit, Choose, the version banner, the delivery receipt, the review overlay) is shell
  DOM, never frame DOM. The frame can only ask for it over the bridge (`mostra/controls.request`),
  and the shell renders only what the view's policy allows (D108).
- **The shell judges from its own sources.** Its event stream on its own origin
  (`src/stream.ts`, `/a/<id>/_mostra/v/<rev>/events`) is what the banner, the receipt and the
  required-field check read; the frame's reports (`mostra/fields`, `mostra/flush`) add labels,
  validation and conflicts, never decide on their own. A trusted Submit posts to the shell origin
  with the shell session's CSRF token, which no artifact code can read (D40, SH-02).
- **A submission is made from what the viewer saw (D110, FAILURE_MODEL §4).** Submit flushes the
  frame, waits for the shell's stream to reach the frame's revision, checks blockers, and posts
  exactly the revision the frame confirmed (`submitRevision` in `src/model.ts`), never a newer one
  only the shell's stream has met. A page with WP-07's runtime (it names its version in
  `ui/initialize`) must answer the flush, or nothing is submitted; a version built before WP-07
  answers nothing and shows the shell's draft. On `MOSTRA_SUBMIT_REVISION_MOVED` the viewer checks
  the answers, which the frame already shows from its own stream, and submits again: nothing is
  sent that wasn't on screen.
- **What a trusted control says and does holds still under the viewer's click (Claude review
  finding 6).** Submit and Choose are disabled for `ARM_MS` (500 ms) after they appear, after
  their words or target change, and after the page is shown (a popup of the shell opened under a
  second click); while the pointer is over the trusted zone, the frame's requests wait until it
  leaves. An artifact's Submit label may not read as one of the shell's states (`Submitted`,
  `Saved`, …), and a confirmation once asked for stays for the view. Rules in `src/model.ts`
  (`withControlRequest`, `controlsArmed`, `allowedSubmitLabel`), tested there and in
  `tests/e2e/specs/controls.spec.ts`.
- **The rail says "Connecting…" until the page's runtime reports** (`mostra/fields`), never a
  "Saved" nobody confirmed; a version built before WP-07 reports nothing, and no save state shows.
- **The frame shows its view's version (D115).** A frame whose build isn't its ticket's version is
  entered again at that version, at most three times in ten seconds.
- **A frame that fails to load is loaded again (D157).** One that loaded without greeting
  (`ui/initialize`) within `GREETING_MS`, or greeted nothing within `LOAD_MS`, is entered again
  with a new ticket, `RELOAD_LIMIT` times with a doubling pause, then `FRAME_WORDS.unreachable`
  shows; `data-frame-reloads` counts the attempts (`gave-up` past the limit). Only a frame that
  never greeted is replaced: its page ran nothing the viewer could lose. So a ticket that arrives
  after the frame greeted or loaded is dropped (the request is aborted and its answer ignored), and
  each ticket request has `RELOAD_TICKET_MS` before it counts as a failed attempt. Every entry of
  the frame (the recovery, D115's re-entry, a version switch) and every greeting go through
  `src/entries.ts`, which drops a ticket asked for before something happened to the frame: never
  call `frameTicket` and `setTicket` around it. `verify` loads a failed frame again once
  (`VERIFY_RELOAD_LIMIT`), and a switch the viewer chooses gets the whole budget again.
- **The frame never navigates the viewer's tab (D98 item 7).** It is sandboxed with every token
  but `allow-top-navigation*`, filtered by `sandbox.supports`; it sends the viewer elsewhere with
  `ui/open-link`, which `src/links.ts` opens in a new tab for the `OPEN_LINK_SCHEMES` only. Don't
  add a top-navigation token, and never open a URL in the shell's own tab.
- **A second link never silently replaces a session (D98 item 8).** On
  `MOSTRA_HYGIENE_SESSION_CONFLICT` the page shows both links' access and exchanges with
  `replace: true` only when the viewer chooses the new one.
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
`src/shell.tsx` the page up to its session (exchange, the choice between two links, errors),
`src/viewer.tsx` the page around one view (the rail, the trusted zone, the frame and its bridge,
the banner, the receipt, the "Not carried over" panel), `src/model.ts` the view's state built from
the shell's stream, `src/stream.ts` that stream, `src/api.ts` its calls to the gateway (session,
ticket, submit, choose, follow, carry), `src/links.ts` `ui/open-link`, `src/messages.ts` what the
page tells a person when it can't show the artifact, and `src/words.ts` every other word the
viewer reads (IN-13: Mirza reviews them).

## Tests to run

`pnpm --filter @mostra/shell test` (location parsing and messages), then the gateway suites:
`pnpm --filter @mostra/runtime test:integration` and `pnpm --filter @mostra/e2e e2e` (Chromium,
Firefox and WebKit). The trusted controls are proven there: `controls.spec.ts` (forgery by
synthetic clicks, overlays and bridge messages, channel policy, policy `none`, delivery states),
`versions.spec.ts` (banner, follow, orphans, stale views) and `client.spec.ts`. Rebuild the shell
after a change: the gateway serves `dist/`.

## Gotchas

- `<html data-shell>` is `loading`, `framed`, `initialized`, `ready` or `error` (with
  `data-shell-error`); end-to-end suites wait on it instead of sleeping. `data-shell-save`,
  `data-shell-page`, `data-shell-switch` and `data-frame-reentries` report the rest; the receipt,
  banner and panel carry `data-mostra-*` attributes.
- The look follows the round-4 direction; its final pass is WP-20's (D68). Keep it quiet, and
  never weaken the trusted zone.
