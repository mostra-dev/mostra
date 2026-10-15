---
code: MOSTRA_SUBMIT_SIGNAL_INVALID
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SUBMIT_SIGNAL_INVALID

Invalid signal. Severity: error. Phase: runtime.

## What it means

A signal names something the artifact wants a host's attention for, such as `ping-agent`. Its name is 1 to 64 characters of letters, digits, `.`, `_` and `-`, starting with a letter or digit, and its payload is JSON of at most 64 KiB. This one broke one of those rules. The name `submit` is reserved for submissions.

## How to fix it

Rename the signal or shrink its payload; put large data into a field or artifact state and send its ID in the payload.

## Hint

Name signals with letters, digits, `.`, `_` and `-`, and keep their payload under 64 KiB of JSON.
