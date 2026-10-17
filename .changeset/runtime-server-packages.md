---
"@mostra/runtime": minor
"@mostra/worker": minor
---

Server code's packages run from their own directories (D135): the server build keeps package imports external, and the worker resolves them from the layout the version was built against, so native addons load and packages find the files beside them. A removed layout is installed again from the store before a worker starts, and a version whose warm packages the runtime no longer holds runs against the ones it locked.
