---
code: MOSTRA_RUNTIME_WORKER_CRASHED
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_RUNTIME_WORKER_CRASHED

Artifact server code crashed. Severity: error. Phase: runtime.

## What it means

The artifact version's worker process exited while serving a call: it threw outside any call, ran out of its heap (1 GiB by default), or kept its event loop blocked past the watchdog (10 s by default). Other artifacts and the gateway keep working (RT-04). Mostra appends `worker.crashed` with the cause and starts the worker again on the next request, waiting longer after each crash (1 s up to 60 s). `verify` reports it too when the source's server code crashes, fails to load or hangs while the page renders, even when the page handled the failed call.

## How to fix it

Fix the crash in the server code. A long synchronous computation can raise `limits.watchdogMs` in the manifest, and a large data set `limits.heapMb`; both are stability limits, not security ones.

## Hint

Read the cause and the worker's last output, fix the server code, and publish again.
