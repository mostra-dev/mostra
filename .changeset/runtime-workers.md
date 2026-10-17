---
"@mostra/runtime": minor
---

Run artifact server code (WP-08): one worker per active version with server code, started on
first need through the `WorkerLauncher` seam, with plain calls, durable action runs (keys,
re-attach, cancel, `interrupted` after a crash, logs capped at 1 MB), secrets from the home's
owner-only store or a host's `secrets` port, signals, host events and state from server code,
live sources and `live/push`, `secret/*` methods, workers and the idle exit in `instance/status`,
the daemon's 30-minute idle exit and `--always-on`, and `mostra-runtime service
install|uninstall|status` for the home's login service.
