---
"@mostra/runtime": patch
---

On Windows, the login service's daemon stops in order when the user's session ends. `mostra daemon uninstall` stops it in order from any logon session, and removes the task even when the home lost its definition. A task removed in Task Scheduler no longer keeps a hand-started daemon from its idle exit. The launcher's stop event has a random name, and the launcher refuses an event that another user created under it. A home is compared by its exact native real path, so two directories NTFS keeps apart are never the same home.
