---
"@mostra/protocol": patch
---

The JSON-RPC core carries only the six HOST diagnostics it raises, not the whole HOST catalog, so browser bundles that use it are about 2 kB smaller (the core alone from 5.8 to 3.8 kB, brotli) and stop growing with each new HOST code (#17).
