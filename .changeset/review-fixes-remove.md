---
"@mostra/runtime": patch
---

`ServerHandle.remove` records its plan in the directory first, so a removal cut off between the home's ledger and the directory is finished by the next call; the route serves nothing meanwhile and takes no push.
