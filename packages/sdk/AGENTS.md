# @mostra/sdk

Mostra for JavaScript hosts (HO-04, D25): `createMostra({ home, ports })` spawns the host's own
instance on a verified runtime bundle. The package also holds the bundle manager (download,
verification, cache, setup) that the CLI's bootstrap and `create-mostra` use. Audience: JavaScript
hosts. Runs in: node, on the host's own Node.js (22.19 or later). May import: @mostra/protocol
(tools/package-map.ts); it reaches the runtime only by spawning `mostra-runtime host` and speaking
the protocol over its stdio.

## Invariants it owns

- **Nothing runs from a bundle that hasn't been checked.** A bundle is used only once
  `.mostra-setup.json` describes it, and only setup (`src/bundle/setup.ts`) writes that marker:
  after `files.json` matched the SHA-256 that `bundle.json` pins, every file matched `files.json`
  (size, SHA-256, execute bit, links staying inside, nothing extra) and the browser matched the
  bundle's pin. A download is checked against the pin in `dist/bundles.json` before it is
  extracted, and it is extracted and checked in a scratch directory before it is renamed into the
  cache.
- **A Windows pipe is opened only through the helper** (`src/control.ts`, D151).
  `connectControl` opens a home's control endpoint: the Unix socket with `node:net`, or on Windows
  `mostra-win connect` beside the runtime the caller resolved, which refuses a pipe another user
  created under the name and never lets the server act as the client. Every client of a daemon
  (the CLI, the end-to-end harness, and from WP-W3 the conformance kit) uses it.
- **The cache is keyed by digest** (`<cache>/bundles/<archive sha256>/`). Concurrent installers of
  one bundle share a lock, but correctness never rests on it: an installer that loses the rename
  uses the winner's directory, which was checked before it was renamed.
- **One definition of a bundle's files.** `describeTree` (the assembler, `packages/bundle/scripts/build.ts`) and
  `checkTree` (setup) share one walk, so writing and checking can't disagree.
- **Ports are checked both ways.** Each port call's params are parsed with its method's schema
  before the host's handler sees them, and the answer is parsed before it goes back. Anything else
  is an error the instance treats as a failed attempt and retries; it never passes silently.
- **No telemetry.** This package contains no code that can send an event (D119, D140 item 1), and
  `telemetry-cli-only` keeps it from importing the CLI's.
- **The event stream never buffers without bound.** Past `highWaterMark` pages it unsubscribes,
  and once the consumer catches up it subscribes again after the last cursor it received.

## Public interface

`src/index.ts`; the API report is `etc/sdk.api.md`. `src/setup-main.ts` is `mostra-setup`, which
the bundle's `bin/mostra-setup` runs.

## Tests to run

- `pnpm --filter @mostra/sdk test`: the bundle manager against synthetic bundles (real archives, a
  fake Playwright installer, a local HTTP server): install, cache, tampering, mirrors, retries,
  offline use, concurrent installers, the platform gate.
- `pnpm --filter @mostra/runtime build`, then `pnpm --filter @mostra/sdk test:integration`: real
  instances through `createMostra` (HO-04, the SDK's IN-10 check).

## Gotchas

- `MOSTRA_TEST_BUNDLE_PINS` points the SDK at test pins; nothing but tests sets it.
- A development checkout has no `dist/bundles.json`, so the SDK runs `packages/runtime/dist` with
  the current Node. Build the runtime first.
- The browser is fetched at setup, never shipped in the archive (D142). Playwright's headless
  shell is Google's Chrome for Testing build, which names Google's terms of service rather than an
  OSI license, so the bundle never carries it (invariant 8).
- **A notification can overtake the answer it follows.** The instance sends `events/subscribe`'s
  answer before the subscription's first page, but both can reach the session in one chunk, and
  the page is dispatched before the code awaiting the answer resumes. `events.ts` keeps pages of
  a subscription it doesn't know yet while a subscribe is in flight. Any client (the Rust crate,
  WP-12) meets the same ordering.
- **An acknowledgement needs a live subscription.** `events/ack` under a subscription whose
  `events/unsubscribe` is already on its way is refused, so a pause acknowledges what was handled
  before it unsubscribes, `next()` never acknowledges during a pause, and a stream that ends while
  paused subscribes once more just to acknowledge. `test/unit/events.test.ts` sweeps the timings
  against a fake instance that answers a round trip later.
