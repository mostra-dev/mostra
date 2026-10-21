# mostra-host-reference

The Rust reference host of Mostra's host conformance kit: `mostra-host` with every port, a store
that keeps each submission once, and the harness shim the kit drives. Copy it to write your own
host's shim; see `packages/conformance/README.md`.

```sh
cargo build -p mostra-host-reference
npx -p @mostra/conformance mostra-conformance --host target/debug/mostra-host-reference
```

Not published. Apache-2.0.
