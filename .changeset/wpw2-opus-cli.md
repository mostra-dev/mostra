---
"@mostra/cli": patch
---

The daemon and the telemetry flusher, which run in their file system's root, get every relative path variable (`MOSTRA_RUNTIME_DIR`, `MOSTRA_HOME` and the rest) resolved against the command's directory. On Windows, a telemetry lock that this user can't create no longer keeps a command busy for 2 s.
