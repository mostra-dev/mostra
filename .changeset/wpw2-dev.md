---
"@mostra/runtime": patch
---

`mostra dev` keeps React Fast Refresh on Windows, where it recognises the entry as Vite names it (`C:/…`); it mirrors a file an editor holds or is saving on the next sync instead of losing the change, removes a file from the preview only when two syncs in a row miss it (an editor that moves the old file aside before writing the new one), titles a source without a manifest as publish does, and removes a session's directory through the platform layer, which rides out a file Windows still holds for a moment.
