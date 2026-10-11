---
code: MOSTRA_PLATFORM_UNSUPPORTED
severity: error
phase: platform
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PLATFORM_UNSUPPORTED

Unsupported platform. Severity: error. Phase: platform.

## What it means

Mostra 1.0 runs on macOS and Linux, on x64 and arm64. On any other operating system or architecture, Windows included, every entry point stops with this code before it creates or changes anything, because the process model, sockets and storage are built and tested only on those platforms. The message names the platform that was detected.

## How to fix it

Run Mostra on a macOS or Linux machine with an x64 or arm64 processor. Windows support is planned for a release after 1.0.

## Hint

Run Mostra on macOS or Linux, on an x64 or arm64 machine.
