---
"@mostra/server": minor
---

Add `@mostra/server`, what server code imports: `dryRun`, `progress`, `log`, `secret`, `signal`,
`emit`, `viewer`, `abortSignal`, `state` and `defineLive`, backed by a per-call AsyncLocalStorage
context, and `@mostra/server/host` for the worker that runs it.
