---
"@mostra/cli": patch
---

`mostra dev` takes a Ctrl-C (or SIGTERM, or Ctrl+Break on Windows) from its first moment: its handlers are in place before the preview starts, so an interrupt that arrives right as the preview is announced stops the session and prints its result instead of ending the process at once.
