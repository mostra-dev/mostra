---
"@mostra/worker": patch
"@mostra/verify": patch
---

On Windows a worker or the verify runner that ends no longer signals a process group, which Windows doesn't have: its gate's Job Object ends its descendants.
