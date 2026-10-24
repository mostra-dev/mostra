---
"@mostra/cli": patch
---

On Windows, a telemetry lock that another process finished deleting just as this one tried to take it no longer makes this process give up without an install ID; a directory this user can't write still gives up within about 60 ms.
