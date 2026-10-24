---
"@mostra/cli": patch
---

On Windows, a telemetry store lock that another process has just released no longer makes a command give up on recording its event: the refusal Windows gives while the old lock is still being deleted counts as the lock being held, and the command waits for it as it does elsewhere.
