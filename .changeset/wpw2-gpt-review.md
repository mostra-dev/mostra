---
"@mostra/cli": patch
---

The CLI starts its daemon with an absolute runtime entry, so a relative `MOSTRA_RUNTIME_BIN` works again now that the daemon runs in its file system root, and the telemetry store gives up on a lock it can neither take nor break within its 2 s instead of trying forever.
