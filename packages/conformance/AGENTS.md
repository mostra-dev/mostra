# @mostra/conformance

The host conformance kit (HO-05, D143): scenarios that prove a host's integration through the
host's own client and ports, a runner that judges them against an expected-failure baseline, the
harness protocol hosts implement to be driven, and the TypeScript reference host. Audience: host
authors. Runs in: node. May import: @mostra/protocol, @mostra/sdk and third-party packages
(tools/package-map.ts); it reaches Mostra only through a host's shim and the public gateway, never
the runtime's internals.

## Invariants it owns

- **Scenarios go through the host.** Every host-protocol call a scenario makes goes through the
  host's shim (`harness/call`), so the host's client, wire types and ports are what is tested. The
  kit itself only plays the viewer (the browser protocol, through the real gateway and route table)
  and, where a scenario is about the instance and not the host, opens its own socket session.
- **A scenario ID is stable surface.** Baselines name scenarios by ID; renaming one breaks every
  host's baseline. New scenarios are additive; WP-13, WP-20, WP-29 and WP-31 add theirs.
- **Skips are honest.** A scenario skips only when the host lacks a port or a harness feature it
  needs (`NotApplicable`), never because something went wrong. The integration suite pins which
  scenarios each reference host skips, so a skip that creeps in fails it.
- **Baselines only shrink.** A listed scenario that passes is `unexpected-pass` and fails the run;
  a baseline naming an unknown scenario is refused before anything runs.
- **Each scenario owns its directory.** A fresh home, runtime directory and shim per scenario,
  removed afterwards (home versions are sealed read-only, so `removeTree` opens them first), with
  any daemon it left shut down.

## Public interface

`src/index.ts`; the API report is `etc/conformance.api.md`. Binaries: `src/cli.ts`
(`mostra-conformance`) and `src/reference-host.ts` (`mostra-conformance-reference-host`).
The harness protocol is `src/harness/protocol.ts`; its revision is `HARNESS_REVISIONS`.

## Tests to run

- `pnpm --filter @mostra/conformance test`: baselines and the runner's judgement against an
  in-process echo shim.
- `pnpm --filter @mostra/runtime build`, then `pnpm --filter @mostra/conformance test:integration`:
  the kit against the TypeScript reference host, its standalone mode and its broken mode (the
  `clients` integration group; it needs Playwright's Chromium for `viewing.shell-bridge`).
- The Rust reference host: `pnpm check --job conformance`.

## Gotchas

- **Scenario directories are under `/tmp` on macOS**: socket paths are capped at 103 bytes
  (D82), and `$TMPDIR` there is long.
- **`delivery.outbox-replay` needs `attach`.** A host-spawned instance ends with its host, so
  "the host is away while Mostra keeps running" exists only for a host that attaches to a daemon.
  The TypeScript reference host spawns; the Rust one does both.
- **Fault points are the runtime's** (`MOSTRA_TEST_FAULTS`, `packages/runtime/src/faults.ts`): a
  scenario passes them through `harness/start`'s `env`, and a host must hand that environment to
  its instance.
- **Publish skips verify by default** (`MOSTRA_TEST_UNVERIFIED_PUBLISH`, loud in the instance's
  log); `--verify` keeps the gate, which needs the verify browser.
