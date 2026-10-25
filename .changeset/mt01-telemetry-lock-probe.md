---
"@mostra/cli": patch
---

On Windows, when creating the telemetry lock is refused and no lock file is there, the CLI now checks whether it can write its config directory at all (a file of its own) instead of giving up after three such rounds, so a lock other processes keep taking and releasing is waited for until the usual 2 s.

On Windows, the CLI's telemetry settings and queue are replaced with retries for up to a second while another process has the file open, which Windows refuses; before, such a command lost its install ID or its notice (seen in CI with twelve processes starting at once).
