---
"@mostra/react": patch
"@mostra/runtime": patch
"@mostra/protocol": patch
---

`useLive` stays `isLoading` until a source's first value or error arrives, when the artifact's producer is loading it. A source whose producer hadn't produced yet was reported loaded with no data, so a page could render (or crash on) a missing value, and `verify` judged and screenshotted the page before its data arrived. The gateway says which sources a first load is on its way for (`LiveState.awaiting`, additive), so a key only `mostra push` writes, or a source that only streams, is never waited for.
