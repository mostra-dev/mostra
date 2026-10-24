---
"@mostra/cli": minor
---

The CLI admits Windows x64 and arm64 behind the development switch `MOSTRA_DEV_WINDOWS=1`, as the runtime does, and fails closed on any other platform or architecture. On Windows it reaches its daemon's pipe through `connectControl`, defaults its home to `%LOCALAPPDATA%\mostra` and its settings to `%APPDATA%\mostra`, opens links with the default browser through Explorer and reads `$BROWSER` as a `;`-separated list; telemetry reports `win32` as the system, and `mostra doctor` reports Windows as the runtime admits it.
