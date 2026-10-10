# mostra-host

Reserved for WP-12, which builds it from ARCHITECTURE §11 and INTERFACES §6 and §7. The crate is
empty and `publish = false` until then; it exists so `cargo fmt`, clippy, nextest and cargo-deny
run in CI. Rust gates: `pnpm check --job rust` and `pnpm check --job format-lint`.
