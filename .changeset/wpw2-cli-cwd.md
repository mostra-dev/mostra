---
"@mostra/cli": patch
---

The daemon and the telemetry flusher the CLI starts no longer keep the directory the command ran in as their working directory, so on Windows that directory can be renamed or removed while they run. A telemetry config directory that can never exist (a part of its path is a file) reads as unreadable on every system, as it did on macOS and Linux.
