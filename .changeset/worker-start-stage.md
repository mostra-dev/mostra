---
"@mostra/runtime": patch
---

A worker whose start runs out of time now says where it was (#111): still loading its server code with its event loop free or blocked, or never reading its channel at all, from a ping its channel thread answers. Each start's launch and start times are logged, and a start still running after 10 s logs the stage it is in.
