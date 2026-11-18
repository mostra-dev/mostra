---
"@mostra/conformance": patch
---

On Windows, `HostUnderTest.close` no longer runs `taskkill /T /F` on the PID of a host shim's shell that has already exited (#140). Windows may give that PID to any new process, so a shim whose descendant kept its output open past the 5 s wait could end an unrelated process and its tree, such as another conformance run's shim on the same machine. `close` now runs `taskkill` only while the shell still runs, and otherwise ends the shell's descendants through the tree it noted, by creation time, as before. A shim that ends before it answers now fails its scenario with its exit code or signal and how long after its start it ended (`exited (code 1, 210 ms after it started)`), with its last five stderr lines.
