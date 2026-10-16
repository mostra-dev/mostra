---
"@mostra/runtime": patch
---

A worker the watchdog stops while its heap is near the limit is reported as out of memory, not as
hung: near the limit, garbage collection stalls the event loop before the heap gives out.
