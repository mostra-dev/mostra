---
"@mostra/cli": minor
---

On Windows the CLI reaches its daemon's pipe through `connectControl`, defaults its home to `%LOCALAPPDATA%\mostra` and its settings to `%APPDATA%\mostra`, opens links with the default browser through Explorer and reads `$BROWSER` as a `;`-separated list; telemetry reports `win32` as the system, and `mostra doctor` reports Windows as the runtime admits it.
