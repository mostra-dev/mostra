---
code: MOSTRA_ENV_SERVICE_FAILED
severity: error
phase: host
---

<!-- Generated from packages/protocol/src/diagnostics/codes by `node tools/docs/diagnostics.ts write`. Edit the area file, not this page. -->

# MOSTRA_ENV_SERVICE_FAILED

Login service could not be installed. Severity: error. Phase: host.

## What it means

`mostra daemon install` couldn't register the home's daemon as a login service: writing the launchd agent or systemd user unit failed, or `launchctl` or `systemctl --user` refused to load it.

## How to fix it

Check the named file's directory permissions, and on Linux that a systemd user session is running (`systemctl --user status`). On a machine without one, start the daemon from your own login scripts with `mostra daemon start`.

## Hint

Read the message, fix what it names, and run the install again.
