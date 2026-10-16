---
"@mostra/react": minor
---

Add `useAction` and `useLive` (WP-08): durable action runs with keys, joining, re-attach after a
reload, progress, log, partial results and cancel; live sources with latest and append modes, and
`LiveSources` typed from `live.ts`. Server references now call the server (`setServerCallback`);
the client runtime's entries carry `"use client"`.
