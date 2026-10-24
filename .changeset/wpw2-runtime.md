---
"@mostra/runtime": minor
---

On Windows (still behind `MOSTRA_DEV_WINDOWS=1`), `mostra-runtime service install` registers the home's daemon as a Task Scheduler task at the user's logon, run without a window by `mostra-win-service.exe` beside the helper, which restarts it 10 s after an unexpected exit; `service uninstall` stops the daemon cleanly and removes the task. `service status` reports, on Windows, whether Task Scheduler holds the task (`registered`). A worker that ends with a Windows status reports it in hexadecimal (`0xC0000005`).
