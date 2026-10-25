---
"@mostra/protocol": minor
"@mostra/sdk": patch
---

A client no longer refuses an answer from a newer Mostra for a value it doesn't know yet. `RpcPeer.call` reads results, and the SDK reads port requests and event pages, through the new `receivable(schema)`: an enum value or a union member a newer instance added within the revision arrives as sent, while everything else is still checked (#45).
