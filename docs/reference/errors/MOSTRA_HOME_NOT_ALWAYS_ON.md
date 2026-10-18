---
code: MOSTRA_HOME_NOT_ALWAYS_ON
severity: warning
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_HOME_NOT_ALWAYS_ON

Long-lived artifacts without an always-on daemon. Severity: warning. Phase: host.

## What it means

The home has artifacts with submission policy `none`, which are meant to stay open (dashboards, task managers, D63), but no login service runs its daemon. Without one, the daemon exits after 30 idle minutes and their links stop answering until a command starts it again.

## How to fix it

Run `mostra daemon install`. It registers a launchd or systemd user service that keeps the home's daemon running; `mostra daemon uninstall` removes it.

## Hint

Run `mostra daemon install` so the home's daemon runs as a login service and these artifacts answer at any hour.
