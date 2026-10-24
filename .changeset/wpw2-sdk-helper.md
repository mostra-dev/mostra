---
"@mostra/sdk": patch
---

On Windows, `connectControl` finds the helper from where the runtime's code really is, as the runtime itself does, so a runtime reached through a link still finds its helper.
