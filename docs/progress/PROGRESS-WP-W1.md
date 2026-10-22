# WP-W1 progress: Windows I, platform layer, supervisor and ledger

**Status:** In progress.

## Baseline

| | |
|---|---|
| Branch | `wp/w1-windows-platform`, created from `origin/main` |
| Starting `HEAD` | `ca21ff9` (`origin/main` at branch time, 2026-10-22: "docs(design): D146, Windows in v1.0 as WP-W1 to WP-W3 (#51)") |
| `git status` | clean |
| `pnpm check` | 13 of 14 jobs green on macOS arm64 in 28 min; `unit` failed on one test, `@mostra/server`'s "abortSignal (AC-04) › is the current call's signal, and stops fetch and timers", which timed out at 5 s under the full run's load and passes alone (16 of 16, 0.6 s). The run overlapped the start of this package's first commit (the new `crates/mostra-win`, which builds and passes clippy on every target). |
| Predecessors | WP-12 done ([PROGRESS-WP-12](PROGRESS-WP-12.md) on `origin/main`); no `RECOVERY-WP-W1-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, Rust 1.97.1 with the `x86_64-pc-windows-msvc` and `aarch64-pc-windows-msvc` targets for `cargo check` and clippy, macOS 26.2 arm64. Windows behavior is observed on GitHub's `windows-latest` (Windows Server 2025, x64) and `windows-11-arm` runners only. |

## The POSIX audit

Every place the code before this package assumed POSIX (modes, signals, process groups, `ps`, `/proc`, socket paths, symlinks, rename and delete semantics, path syntax), found by searching `packages/*/src` for `process.platform`, `chmod`, octal modes, `kill(-…)`, `/bin/sh`, `ps`, `/proc`, `.sock`, `symlink`, signal names, `detached`, `getuid`, `.uid`, `rename`, `realpath` and path separators, and by the Windows runs of the suites. A unit test (`platform-layer.test.ts`) now refuses any `process.platform` read outside `platform`.

| Where | POSIX assumption | Now |
|---|---|---|
| `home/platform.ts` | the gate refused every Windows | `MOSTRA_DEV_WINDOWS=1` admits win32 x64 and arm64; everything else fails closed (D150 item 7) |
| `home/paths.ts`, `bin.ts` | default homes for macOS and Linux; `getuid()` and `stat.uid` ownership; `chmod 0700` tightening; the XDG runtime directory | `platform/directories.ts`: `%LOCALAPPDATA%\mostra`, owner-only access lists through `mostra-win secure-dir`, no runtime directory on Windows; POSIX unchanged |
| `protocol-server/server.ts`, `instance/index.ts` | a Unix socket file, `unlink` before bind, `chmod 0600`, healing by inode | `platform/control.ts`: the socket on POSIX; on Windows the helper's owner-only pipe, rebound under a new name when its helper stops, `instance.json` rewritten (D150 item 4) |
| `processes/identity.ts` | `/proc/<pid>/stat`, `ps -o lstart`, `kern.boottime`, `/proc/sys/kernel/random/boot_id` | moved to `platform/identity.ts`; Windows reads `GetProcessTimes` through the helper (`win/<creation time>`); start times compare as integers |
| `processes/manager.ts` | a `/bin/sh` gate on descriptor 3; `detached` process groups; `kill(-pgid)`; SIGTERM then SIGKILL; reaping by group members' start times | `platform/launch.ts`: the POSIX gate and groups unchanged; on Windows `mostra-win gate`, a Job Object per child, the lifeline, reaping by named job and creation time (D150 item 5) |
| `processes/child.ts` | a child ends its group with `kill(-pid)` on disconnect | unchanged on POSIX; on Windows the gate's job ends the descendants once the child exits |
| `bin.ts` | SIGTERM and SIGINT stop an instance; the exit handler kills groups | also Ctrl+Break (`SIGBREAK`); the exit handler calls `ProcessManager.killAll()`; Windows stops over `mostra/shutdown` (D150 item 6) |
| `ledger/index.ts`, `home/settings.ts`, `home/record.ts` | `fsync` through a read-only descriptor; rename over an open file; removal of an open ledger detected by inode | `platform/files.ts`: sync through a writable handle; renames ride out sharing violations; on Windows an open ledger can't be removed or renamed at all (D150 item 8) |
| `registry/store.ts` | sealing by `chmod 0444/0555`; removal after `chmod 0755`; a rename over a leftover directory | on Windows a protected read-only access list set after the rename into place, removed through `unseal`; renames retried (D150 items 3, 8) |
| `publish/source.ts`, `publish/tar.ts` | names that differ only in case are two files; the execute bit from `mode & 0o111` | on Windows names compare without case (a collision names both); Windows keeps no execute bit, so none is recorded |
| `deps/index.ts`, `builder/child/spa.ts`, `builder/child/dev.ts`, `verify/typecheck.ts` | directory symlinks (`warm`, `node_modules`), replaced by a rename of a new link | junctions on Windows, replaced by remove-then-create (`platform/files.ts`) |
| `deps/child/install.ts` | pnpm in the install child's process group | on Windows in its Job Object; no console window |
| `processes/environment.ts`, `builder/index.ts` | `PATH`, `HOME`, `TMPDIR` are enough; `:` separates `PATH`; names have one spelling | `platform/environment.ts` and the artifact environment add what Windows programs need, matched without case, with the host's delimiter |
| `protocol/src/artifact.ts`, `methods/artifact/create.ts` | an absolute path starts with `/` | Windows drive and UNC paths too, additively (the schema gate proves the widening) |
| `deps/warm.ts`, `verify/runner.ts` | the runtime's root found by walking directories | `platform.runtimeRoot` (unchanged behavior) |
| `service/unit.ts` | `process.platform` for launchd or systemd | reads `OS`; the Windows login service is WP-W2's |

Left for later packages, by their specifications:
- **WP-W2:** `secrets/index.ts` and `gateway/capabilities.ts` (`chmod 0600/0700`: on Windows these files already inherit the home's owner-only list, which WP-W2's secret-store check proves); `service/unit.ts` (`launchctl`, `systemctl`, `getuid`: the Windows login service); `workers/launcher.ts` and `workers/pool.ts` (crash kinds read from signals such as `SIGABRT`); `@mostra/worker` and `@mostra/verify` (`kill(-pid)` on disconnect; their gate's job covers descendants already); the CLI (`browser.ts`'s `open`/`xdg-open`, `telemetry/store.ts`'s modes and `XDG_CONFIG_HOME`, `commands/dev.ts`, `commands/admin.ts`, `client.ts`, `run.ts`, `bootstrap.ts`'s signals); `verify`, `dev` and the gateway's directories (modes only, covered by inheritance).
- **WP-W3:** `@mostra/sdk` (`platform.ts`'s gate, `bundle/cache.ts`, `bundle/tree.ts`, `bundle/download.ts`, `mostra.ts`), `create-mostra`, `@mostra/conformance` (`harness/client.ts`, `scenario.ts`, `scenarios/session.ts`: Unix sockets), the Rust crate's attach (`crates/mostra-host`), and the bundle's POSIX launchers.
