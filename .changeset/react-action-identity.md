---
"@mostra/react": patch
---

`useAction` shows the run of its current function and key: a component that changes its key no
longer shows, cancels or joins the old key's run. `useLive` applies reads and updates of a source
in the order they arrived, and a late read never takes newer points out of an append window.
