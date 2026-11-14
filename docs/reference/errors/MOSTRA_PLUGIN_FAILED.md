---
code: MOSTRA_PLUGIN_FAILED
severity: error
phase: runtime
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_PLUGIN_FAILED

Plugin failed. Severity: error. Phase: runtime.

## What it means

A plugin's contribution threw, returned something its contract doesn't allow (a file outside the export, a result that isn't JSON), or ran past its time limit while Mostra ran it. It runs in a child process of the instance, so the instance and other artifacts are unaffected; nothing it returned was kept.

## How to fix it

Fix the contribution if it is your plugin; otherwise update or remove it (`mostra plugin remove`).

## Hint

Read the plugin's error in the message and report it to the plugin's author if it isn't yours to fix.
