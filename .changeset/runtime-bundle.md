---
"@mostra/runtime": minor
---

Run from a runtime bundle (RT-01, D142): verify renders with the bundle's own browser whatever `PLAYWRIGHT_BROWSERS_PATH` the environment names, and the children that run an artifact's own code (package installs and workers) find the runtime's private Node.js first on their `PATH`, so a lifecycle script or server code that runs `node` works on a machine with no other Node.js.
