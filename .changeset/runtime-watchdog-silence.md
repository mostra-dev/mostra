---
"@mostra/runtime": patch
---

A worker is stopped for silence only after three unanswered watchdog pings in a row, so a ping
queued behind a large result never stops a worker; plain calls stop at 16 MiB of result like runs,
a reader that goes away cancels its call, and a cancel ends a run at once while its worker starts.
