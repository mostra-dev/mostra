---
"@mostra/cli": patch
---

On Windows, reading the telemetry install ID is tried again for up to a second when another process holds the file for a moment, so racing first runs agree on one ID (#129).
