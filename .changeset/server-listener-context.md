---
"@mostra/server": patch
---

A listener added to `abortSignal` by several calls runs in the context of each call that added it.
