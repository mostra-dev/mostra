---
"@mostra/cli": patch
---

Telemetry's lock is taken from a crashed process only under a break lock of its own, so a slow breaker can no longer move a live owner's lock aside and bring it back after its owner released it, which held other commands' telemetry up for 10 s (#98).
