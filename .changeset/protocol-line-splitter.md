---
"@mostra/protocol": patch
---

`LineSplitter` searches only each new chunk for a newline, so a long message costs time in
proportion to its length: a 32 MiB line in 64 KiB chunks took 1.6 s and now takes 20 ms.
