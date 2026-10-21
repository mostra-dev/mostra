# @mostra/conformance

Prove that a host's Mostra integration holds. The kit runs scenarios against your host (durable
submissions, delivery once in effect across crashes, retries and outbox replay, identity, trusted
controls, hygiene, version negotiation, long-lived state, the authoring directory's removal, and
more), compares the outcome with your expected-failure baseline, and exits 0 only when nothing
changed for the worse.

## How it reaches your host

Your host ships a small **harness shim**: a program the kit starts, which reads JSON-RPC 2.0
requests on stdin (one per line) and answers them with your real integration. Any language works.

| Method | Your shim |
|---|---|
| `harness/initialize` | names the host, the ports it registers and its features (`attach`, `faults`, `events`) |
| `harness/start { home, env, mode? }` | starts or attaches to your Mostra instance for that home, adding `env` to its environment |
| `harness/call { method, params, timeoutMs? }` | sends one host-protocol request through your client; answers `{ result }` or `{ error }` |
| `harness/stop` | ends your session |
| `harness/store` | reports what your own store holds: deliveries, draft mirrors, activations, identity, policy and secret calls |
| `harness/script` | (feature `faults`) answers a port the way the kit asks |
| `harness/events` | (feature `events`) reads pages from your own named event stream |

TypeScript hosts write the shim with `serveHarness`:

```ts
import { serveHarness } from "@mostra/conformance";

await serveHarness({
  initialize: () => ({ host: { name: "my-host", version: "1.0.0" }, ports: ["submissions"], features: [] }),
  start: (params) => myHost.startMostra(params.home, params.env),
  call: (method, params) => myHost.mostra.call(method, params),
  stop: () => myHost.stopMostra(),
  store: () => myHost.conformanceStore(),
});
```

Rust hosts copy `crates/mostra-host-reference` in the Mostra repository.

## Running it

```sh
npx -p @mostra/conformance mostra-conformance --host "node my-harness.js" --baseline conformance.json
npx -p @mostra/conformance mostra-conformance --list
```

`--only <id or prefix>` picks scenarios, `--json` prints the report, `--verify` publishes through
verify's gate (it needs the verify browser). Exit codes: 0 conformant, 1 not, 2 a usage error.

## Baselines

A host that fails a scenario today records it with the reason:

```json
{ "schemaVersion": 1, "expectedFailures": { "delivery.exactly-once": "our store isn't idempotent yet (#123)" } }
```

The run stays green while those fail and goes red when a new scenario fails or a listed one passes,
so the baseline only ever shrinks.

## Reference hosts

`mostra-conformance-reference-host` is the TypeScript reference host, built on `@mostra/sdk`.
`--standalone` registers no port (Mostra's built-in adapters); `--break <fault,…>` is a
deliberately broken host for proving the kit. Both reference hosts pass every scenario that applies
to them.

License: Apache-2.0.
