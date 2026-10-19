---
"@mostra/cli": minor
---

`mostra` installed from npm runs on Mostra's own runtime bundle (RT-01): on first use it downloads the bundle its release pins, checks it against its SHA-256 and file list, caches it, then runs the bundle's own `mostra` with the same arguments on the bundle's private Node.js, so the system's Node.js version no longer matters. Inside a bundle the CLI runs the bundle's runtime with the bundle's Node.js, and `mostra doctor` reports the bundle (`--deep` checks every file and the verify browser against their SHA-256).
