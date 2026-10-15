---
code: MOSTRA_SUBMIT_POLICY_NONE
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_SUBMIT_POLICY_NONE

Artifact takes no submissions. Severity: error. Phase: runtime.

## What it means

The artifact's submission policy is `none` (D63): long-lived artifacts such as dashboards and task managers talk to agents through artifact state, actions, signals and events, and the shell shows no Submit control. Mostra refuses a submit, and a `wait --until submitted`, on such an artifact.

## How to fix it

Wait for a signal (`--until signal:<name>`), a state change (`--until state:<field>`) or an event instead, and read state with `mostra state get`. To collect submissions, publish with policy `once` or `epochs`.

## Hint

Exchange data through artifact state, actions and signals; this artifact has no submissions.
