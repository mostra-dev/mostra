---
code: MOSTRA_HOST_INTERNAL_ERROR
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOST_INTERNAL_ERROR

Unexpected failure in the instance. Severity: error. Phase: host.

## What it means

The instance failed while handling the request, for a reason that isn't one of its known conditions. Durable state is unaffected: a request is acknowledged only after its ledger transaction commits. The details are in the instance's log (`logs/supervisor.log` in the home), not in the response.

## How to fix it

Retry the request with the same request ID; retries are idempotent. If the failure repeats, report it with the relevant lines of `logs/supervisor.log`.

## Hint

Retry the request with the same request ID; if it fails again, report it with the instance's log.
