---
"@mostra/cli": patch
---

On Windows, many CLI processes starting at once no longer leave some without an install ID: when creating the telemetry lock is refused and no lock file is there, the CLI now checks whether it can write the directory at all (a file of its own) instead of giving up after three such rounds.
