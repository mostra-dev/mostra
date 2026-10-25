---
code: MOSTRA_PLATFORM_UNSUPPORTED
severity: error
phase: platform
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PLATFORM_UNSUPPORTED

Unsupported platform. Severity: error. Phase: platform.

## What it means

Mostra runs on macOS, Linux with glibc and Windows, each on x64 and arm64. On any other operating system or architecture (32-bit Windows, musl-based Linux such as Alpine, BSDs) every entry point stops with this code before it creates or changes anything, because the process model, the control endpoint, storage and the runtime bundle are built and tested only on those platforms. The message names the platform that was detected.

## How to fix it

Run Mostra on macOS, a glibc-based Linux or Windows, with an x64 or arm64 processor. On Alpine Linux, use a glibc-based image instead.

## Hint

Run Mostra on macOS, glibc-based Linux or Windows, on an x64 or arm64 machine.
