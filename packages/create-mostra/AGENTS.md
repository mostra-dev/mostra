# create-mostra

Audience: people (and agents) running `npm create mostra`. Runs in: node, the system's own
(Node.js 22.19 or later). May import: @mostra/cli (tools/package-map.ts).

## Purpose

`npm create mostra [dir]` (RT-01): creates an artifact with `mostra new` through the
`@mostra/cli` it depends on, so the first run also installs the runtime bundle that release pins
(the CLI's bootstrap: download, SHA-256 and file checks, the verify browser), then prints what to
run next.

## Invariants it owns

- **No behavior of its own.** It runs the CLI's `mostra new <dir>` with every other argument as
  given, and exits with the CLI's code. Anything it would need beyond that belongs in the CLI.
- **`--json` stays one envelope.** With `--json`, stdout is exactly the CLI's envelope; the next
  steps are printed only for a person.
- **Nothing global.** No global install, no shell profile edits, no telemetry of its own (the
  CLI's telemetry rules apply to the `mostra new` it runs, D140).

## Public interface

`src/index.ts` (`plan`, `create`, `nextSteps`, `USAGE`); the binary is `src/bin.ts`. The API report
is `etc/create-mostra.api.md`.

## Tests to run

`pnpm --filter create-mostra test` (the plan), then, with the runtime and the CLI built,
`pnpm --filter create-mostra test:integration` (the binary against a real development instance).

## Gotchas

- The words in `USAGE` and `nextSteps` are agent-facing prose (D74); change them with Mirza.
- In a development checkout the CLI finds the runtime beside it, so the integration test never
  downloads; the bootstrap itself is proven by the CLI's tests and the bundle smoke test.
