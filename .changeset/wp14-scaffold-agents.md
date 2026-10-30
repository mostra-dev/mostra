---
"@mostra/runtime": minor
---

`mostra new` (`artifact/create`) also writes an `AGENTS.md` with the artifact's loop (verify, publish, wait, results), its rules and where the guide is, pinned to this release's CLI, and a `CLAUDE.md` that imports it, so the next agent working in the directory knows how to finish the artifact. `files` lists all three; a retried creation completes them as it completes the entry.
