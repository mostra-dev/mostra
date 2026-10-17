---
"@mostra/runtime": patch
---

A link sees only the runs of functions it may run, before anything is attached for it; a run's
progress and a live source's errors are redacted like its other output; a call during a worker's
idle stop waits for it instead of starting workers the version can't hold; a publish that clears a
park starts the artifact's live producers again, also when it reuses the version.
