# @mostra/worker

Audience: the runtime bundle. Runs in: node, one process per active artifact version with server
code (RT-03). May import: `@mostra/protocol` and `@mostra/server` (tools/package-map.ts); never
`@mostra/runtime`.

## Purpose

The process that runs an artifact version's server code (ARCHITECTURE §7): `"use server"`
functions as plain calls and action runs, and the live producers of `live.ts`. A `WorkerLauncher`
in the runtime starts it (D124) with `main.js --channel fd:4|unix:<path> --version-dir <dir>
[--source-dir <dir>]`; the first request on the channel is `worker/start`, which loads the
version's server bundle.

## How it works

- `src/worker.ts` (main thread): loads the bundle, runs each call inside `@mostra/server`'s
  request context, writes results with the serializer (streamed as `worker/batch`), and runs the
  live producers (`load`, `refresh`, `watch`, `stream`). Console output inside a call also goes to
  its run's log.
- `src/channel-thread.ts` (a worker thread): owns the connection. It answers `worker/ping` from the
  heartbeat the main thread writes into shared memory (`src/shared.ts`) every 100 ms, so a blocked
  event loop shows to the watchdog, and it carries `server/secret`, which the main thread waits for
  with `Atomics.wait`, since `secret()` is synchronous.

## Invariants it owns

- **Only serializable messages (D124).** Everything crosses the channel as JSON-RPC lines; the
  worker works the same over a pipe from the local launcher or a socket from anywhere else.
- **No secrets in its environment (D44, D124).** A secret reaches the worker only as the answer to
  its own `server/secret` request. Never read secrets from `process.env` here.
- **Never sees a browser request.** Calls arrive with their context (viewer, view, run, dry run);
  no cookie, token or header reaches server code.
- **One `@mostra/server`.** The resolve hook in `resolveVersionImports` maps the bundle's
  `@mostra/server` to this package's copy, so the context the worker sets is the one server code
  reads (D19 seam 3).
- **Packages run from their own directories (D135).** The server bundle imports packages by
  name; the same hook resolves the bundle's package imports from `--modules`, the layout the
  version was built against, so native addons load and packages find their own files. Imports
  inside packages resolve as Node resolves them.
- **Dies with its channel.** When the channel closes, the worker signals its process group and
  exits, so programs server code started end with it (the same rule as the runtime's children).
- **Full capability (D05, AC-01).** Nothing restricts what server code does.

## Public interface

`src/index.ts` (`workerEntry`, `runWorker`; the API report is `etc/worker.api.md`) and the process
entry `src/main.ts`.

## Tests to run

`pnpm --filter @mostra/worker test`: the worker as a real process over a socket against a fake
supervisor (calls, streamed results, cancellation, secrets, the ping, signals and state, live
producers, exit on channel close). The runtime's integration suite runs it through real launchers.

## Gotchas

- The channel thread's file is found beside `worker.ts` with the same extension (`.ts` from
  source, `.js` built); `tsdown.config.ts` builds it as its own entry.
- An unhandled rejection in server code ends the worker, as it ends any Node process; the
  supervisor reports the crash and restarts the worker with backoff.
