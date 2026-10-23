---
"@mostra/protocol": minor
---

Adds `MOSTRA_ENV_HELPER_MISSING`: on Windows the runtime needs its helper, `mostra-win.exe`, and reports this code when it can find none. A source path, an artifact path and `artifact/create`'s directory may also be a Windows absolute path (`C:\…`, `C:/…` or `\\server\share\…`), beside the POSIX `/…`; a drive-relative or root-relative path is still refused.
