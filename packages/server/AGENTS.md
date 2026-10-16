# @mostra/server

Audience: artifact authors (worker). Runs in: node, inside an artifact version's worker. May import:
`@mostra/protocol` (tools/package-map.ts).

## Purpose

What server code imports (INTERFACES §2.4): `dryRun`, `progress`, `log`, `secret`, `signal`,
`emit`, `viewer`, `abortSignal`, `state` and `defineLive`. `@mostra/server/host` is the worker's
side: `installServerHost`, `runWithContext`, `currentCall` and `liveSourceOptions`. Artifact code
never imports `/host`.

## Invariants it owns

- **One request context per call (D19 seam 3).** Every helper reads the current call from the one
  `AsyncLocalStorage` in `src/context.ts`; the worker runs each call with `runWithContext`, so
  concurrent calls never see each other's viewer, run or `abortSignal`. Listeners added to
  `abortSignal` are bound to the call that added them (`AsyncLocalStorage.bind`), because an abort
  from outside the call (a cancel from the supervisor) would otherwise run them without it.
- **One copy per worker.** An artifact's server bundle keeps `@mostra/server` external, and the
  worker resolves it to its own copy, so the bundle and the worker share the context. Never
  bundle this package into a version.
- **No I/O of its own, no capability limits (D05, AC-01).** Everything that reaches Mostra goes
  through the installed `ServerHost`; nothing here restricts what server code does.
- **Checks before the channel.** `signal` and `emit` refuse bad names and payloads over 64 KiB
  synchronously, with the codes the supervisor would answer, so a mistake throws where it is made.
- **`secret()` is synchronous** (INTERFACES §2.4): the worker answers it by blocking on its
  channel thread; this package only asks the host.

## Public interface

`src/index.ts` (the API report is `etc/server.api.md`) and `src/host.ts`.

## Tests to run

`pnpm --filter @mostra/server test`: the context across concurrent `await`s, `abortSignal` with
`fetch` and timers, listener binding, the checks, state, and `defineLive`.

## Gotchas

- `abortSignal` is a proxy of the current call's signal: pass it as it is (`fetch(url, { signal:
  abortSignal })`); don't store `abortSignal.aborted` before awaiting, read it after.
- Outside a call (module scope, a timer the module started) `viewer()` is `undefined`, `dryRun()`
  is false, `progress` does nothing and `log` writes to the worker's own log.
