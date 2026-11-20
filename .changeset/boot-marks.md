---
"@mostra/shell": patch
"@mostra/react": patch
---

The shell and the client runtime mark each step of their start in the browser's performance timeline (`mostra:shell:*` and `mostra:client:*`: the session asked for and read, the frame ticket, `ui/initialize` sent and answered, the journal opened, each state of the shell), so a page that stalls while it starts shows in a browser's tools which step it stalled after (#95, #39). Nothing is shown or sent.
