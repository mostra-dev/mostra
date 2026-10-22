---
"@mostra/runtime": minor
---

The runtime gains a platform layer and runs its supervisor, ledger, builder and dependency store on Windows x64 and arm64, behind the development switch `MOSTRA_DEV_WINDOWS=1` until Windows support is complete: the home defaults to `%LOCALAPPDATA%\mostra` and is owner-only by access control, attached clients reach the supervisor through an owner-only named pipe, and every child runs in a Job Object that ends with it, recorded by PID and creation time. Every other platform still fails closed with `MOSTRA_PLATFORM_UNSUPPORTED`. `ProcessManager` gains `killAll()`, which ends every child at once at the supervisor's exit.
