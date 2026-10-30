---
"@mostra/react": patch
---

`useLive` stays `isLoading` until a source's first value or error arrives. A source whose producer hadn't produced yet was reported loaded with no data, so a page could render (or crash on) a missing value, and `verify` judged and screenshotted the page before its data arrived.
