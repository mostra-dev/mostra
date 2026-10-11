# @mostra/react

Audience: artifact authors (browser). Runs in: the browser, compiled into every version. May import:
`@mostra/protocol` (types), `react`, `react-dom`, `react-router` (tools/package-map.ts).

## Purpose

The client runtime artifact authors import (INTERFACES §2.3). Today it has `defineArtifact`, the
typed manifest helper, and `createServerReference`, the client stub the builder emits for every
export of a `"use server"` module. WP-07 adds fields, submissions, signals and the rest of §2.3;
WP-08 adds `useAction`, `useLive` and the transport that makes server references reach a worker.

## Invariants it owns

- **`defineArtifact` is the identity function.** Mostra reads the manifest statically and never runs
  it (D51), so the function may only type-check and return its argument.
- **Client-only and environment-free (D19 seam 4).** No Node built-ins, no module-level singletons
  that assume a browser global at import time, no import of server code. Size-limit gates the entry.
- **A server reference without a transport fails loudly.** It rejects with
  `MOSTRA_TARGET_UNAVAILABLE`; it never resolves with a made-up result.

## Public interface

`src/index.ts`; the API report is `etc/react.api.md`. `createServerReference` is public because
compiled versions import it, but artifact code never calls it.

## Tests to run

`pnpm --filter @mostra/react test` (types included: `expectTypeOf` and `@ts-expect-error`), then
`pnpm check --affected`. The runtime's build tests compile artifacts against it through
`@mostra/warm`.

## Gotchas

- Every published version embeds the copy it was built with and never changes, so what this
  package says to the gateway must stay compatible across releases (the browser protocol, VR-10).
- Import protocol values (not types) only with care: the diagnostic catalog would land in every
  artifact's bundle.
