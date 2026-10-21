---
"@mostra/sdk": patch
---

A host started without ports clears the record of the ports it always provides, so nothing waits for a port it no longer serves; and the bundle installer touches its lock while an install runs, so an install longer than an hour is never taken from it.
