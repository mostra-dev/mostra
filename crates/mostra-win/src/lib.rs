//! Mostra's Windows platform helper (WP-W1, RT-10). The runtime runs `mostra-win` for what
//! Node.js can't do on Windows: owner-only access control on the home, the home's control pipe,
//! every child process in a Job Object behind a gate, and process identity by creation time. It
//! is built for Windows only; on other systems the binary reports that and exits 2.
//!
//! The runtime's `platform` module (`packages/runtime/src/platform/`) is its only caller; its
//! commands and their JSON answers are documented in `main.rs`.

// The library is internal to the crate's two binaries: nothing outside them calls it, so its
// functions need no `# Errors` sections or `#[must_use]` for callers elsewhere.
#![allow(clippy::missing_errors_doc, clippy::must_use_candidate)]

#[cfg(windows)]
pub mod win;
