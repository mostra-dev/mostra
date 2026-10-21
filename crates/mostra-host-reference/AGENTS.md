# mostra-host-reference

The Rust reference host of the conformance kit (HO-05, D143): a host built on `mostra-host` with
every port the crate serves, a store that keeps each submission once by its `deliveryId`, and the
harness shim `@mostra/conformance` drives over stdio. Not published; a Rust host copies it to write
its own shim.

## Invariants it owns

- **It is a real host.** Every host-protocol call goes through `mostra-host`'s client and every
  port through its traits, so the kit's verdict on it is a verdict on the crate.
- **Its store is a host's database.** A redelivery of a `deliveryId` it holds is accepted and
  never stored twice; `--break store-duplicates` is the only way it stores one twice.
- **The faults are named.** `--break` takes only `store-duplicates`, `drafts-as-submissions` and
  `ignore-policy`; `packages/conformance/baselines/reference-host-rust-broken.json` lists the
  scenarios they break, and the `conformance` job proves the list exact.

## Tests to run

`pnpm check --job conformance`: the kit against this host with every port, standalone, and broken
with its baseline (it builds the runtime and the kit first).

## Gotchas

- The harness answers requests concurrently: a `wait` in flight never holds up the next request.
- It spawns or attaches (`harness/start`'s `mode`), so `delivery.outbox-replay` runs against it.
