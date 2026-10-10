//! Rust host crate for Mostra, the agent artifact runtime.
//!
//! This crate is reserved: WP-12 builds the wire types, the tokio client, spawn and attach,
//! runtime-bundle management and the port traits here. Until then it exists so the cargo
//! workspace, `cargo fmt`, clippy, nextest and cargo-deny run in CI from the first commit, and it
//! is not published.
