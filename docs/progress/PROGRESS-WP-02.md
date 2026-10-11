# WP-02 progress: instance, ledger and host protocol server

**Status:** Candidate, awaiting the independent review (D80) and Mirza's acceptance. The report is finalized after acceptance (work-packages/README.md §4).

## Baseline

| | |
|---|---|
| Branch | `wp/02-instance`, created from `origin/main` |
| Starting `HEAD` | `ca5ec05402e18fc3849c7d7fb8e3b12cbf3db2f1` (`origin/main` at session start, 2026-10-11) |
| `git status` | clean |
| `pnpm check` | green: format-lint, types, unit, build, boundaries, api, licenses, rust, docs and commits all pass (33 s, macOS arm64) |
| Predecessors | WP-01 done ([PROGRESS-WP-01](PROGRESS-WP-01.md) on `origin/main`); no `RECOVERY-WP-02-*.md` |
| Local toolchain | Node 24.12.0, pnpm 12.9.0, macOS arm64 |
| Pull request | [#6](https://github.com/mostra-dev/mostra/pull/6), draft |

## What was built

- **`@mostra/protocol`:** the one JSON-RPC 2.0 core (D83): `RpcPeer` (correlation, timeouts, close, handler errors as diagnostics, no batches), `RpcError` with the INTERFACES §6 error codes, message schemas, newline framing with a line limit. Browser-safe and tree-shakable: the build keeps one module per file, and size-limit gates the core at 5 kB (measured 4.35 kB). The session methods `mostra/initialize`, `mostra/shutdown` and `instance/status` with the D84 shapes. Eighteen new diagnostic codes (HOME, HOST and PLATFORM areas) with docs pages.
- **`@mostra/runtime`** (new), modules per REPO_STANDARDS §3 and D85:
  - `home`: the platform gate, home and runtime-directory resolution (D82, D84), ownership and 0700 rules, the socket name, taking the ledger lock or finding and attaching to the owner, `instance.json`, the home-gone watch.
  - `ledger`: better-sqlite3 with WAL, `synchronous=FULL` and `locking_mode=EXCLUSIVE` (D81); a new ledger built aside and linked into place; ordered migrations in one transaction after `quick_check` and a `VACUUM INTO` backup; `MOSTRA_HOME_TOO_NEW`, `_LEDGER_UNREADABLE`, `_DISK_FULL`; writes fail closed with `MOSTRA_HOME_GONE` when the file was removed.
  - `processes`: process identity (PID plus boot and start time, Linux `/proc` and macOS `ps`), the process manager (process groups, `child` rows before use, groups ended with their child, adoption of programs in their own session), reaping on start, JSON-RPC over Node IPC, and `connectToSupervisor` for children.
  - `protocol-server`: one dispatcher for stdio and the socket, session rules, revision negotiation, the home check, port registration per connection, the self-healing socket, the session methods.
  - `instance`: the composition root and the `mostra-runtime host|daemon` binary, with clean stops on SIGTERM, SIGINT, `mostra/shutdown` and stdio close (D87).
- **Repository machinery:** the `integration` job on macOS and Linux (D86) with its Turborepo task; `pnpm check` reports whether each task ran or was cached; gate copies now copy every workspace package's links; the diagnostic generator exports a new area from the package entry; `scripts/prove-seeds.ts` replays the seeded violations below.

## Decisions taken in the package

M13 and D81 to D88 (recorded on this branch): the ledger lock decides ownership; the runtime directory and socket name; one JSON-RPC core without batches; the `mostra/initialize` shapes with `HomeConfig.path` as a check; the runtime binary and modules; the `integration` CI job; stopping an instance; the prose review scope. Within those:

- `mostra/shutdown` from an attached client of a host-spawned instance is refused with a new code, `MOSTRA_HOST_SHUTDOWN_REFUSED`: D87 lets attached clients stop a daemon, and a host owns its spawned instance's lifetime.
- A failed `mostra-runtime host` start still speaks the protocol: it answers the host's first request with the diagnostic, then exits 3. `daemon` prints one JSON status line (`started`, `attached` or `failed`).
- `child` gains a housekeeping column, `parent_pid`, for adopted programs; `ledger_lock` records the owner (DATA_MODEL §3).
- `log.ts` is a shared file, not a module, so the module list stays the dossier's.

## Evidence

| ID | State | Check | Command | Result |
|---|---|---|---|---|
| RT-06 | verified | 16 `mostra-runtime daemon` starters on a fresh home, three rounds: one `started`, fifteen `attached` to its PID, one live process. SIGKILLed owner with its stale socket and `instance.json`: one of five new starters takes the home, four attach. A deleted socket is re-created within 10 s; a starter with another runtime directory finds the owner through `instance.json`; a frozen owner gives `MOSTRA_HOME_LOCKED` with its PID; `mostra host` on an owned home gives `MOSTRA_HOME_LOCKED` over stdio. The protocol suite passes identically over `mostra-runtime host` stdio and a socket attached to `mostra-runtime daemon` | `pnpm --filter @mostra/runtime test:integration` (`instance.test.ts`, `protocol-suite.test.ts`); CI run [38120269565](https://github.com/mostra-dev/mostra/actions/runs/38120269565) `integration (ubuntu-latest)` and `(macos-latest)`; `node packages/runtime/scripts/prove-seeds.ts --only RT-06`; 15 more race rounds by script | all green on macOS and Linux. Seeds: non-exclusive lock, unreachable owner, stale socket not replaced: each red, green when restored. Two defects found and fixed with regression tests: a winner removed other starters' half-built ledger files (about one round in six), and closing the old listener deleted a re-created socket |
| RT-07 | verified | Daemon and host under a simulated platform (`node --import test/fixtures/platform.mjs`): win32-x64, win32-arm64, freebsd-x64, linux-ia32 each fail with `MOSTRA_PLATFORM_UNSUPPORTED`, exit 3, and create neither the home nor the runtime directory; host answers its first request with the diagnostic. The same preload with the real platform starts. Unit test of the gate for every supported pair | `test/integration/platform.test.ts`, `test/unit/home.test.ts`; CI run [38120269565](https://github.com/mostra-dev/mostra/actions/runs/38120269565): `integration`, `rust` and `unit` legs green on `ubuntu-latest` and `macos-latest`; `prove-seeds.ts --only RT-07` | 9 integration tests green on both platforms; seed (gate removed) red with 8 failures, green when restored |
| RT-09 | verified | A real supervisor (`startInstance`) runs a demo dev server (shell plus two grandchildren in its group) and a PTY host whose program runs in its own session and is adopted. SIGKILL the supervisor: the PTY host exits on IPC disconnect; the demo group and the PTY program survive. The next `mostra-runtime daemon` reports `reaped: 2` and every survivor disappears; a row whose PID now belongs to an unrelated process with another start time, and a row whose group ID an older, unrelated group reuses, are skipped (`pid reused`, `gone`); `child` is empty afterwards. Process-manager tests: groups end with their child, rows are removed, only group leaders can be adopted | `test/integration/reaping.test.ts`, `test/integration/processes.test.ts`, `test/unit/identity.test.ts` (Linux `/proc` parsing, macOS `ps` parsing, live identity); CI run [38120269565](https://github.com/mostra-dev/mostra/actions/runs/38120269565) on both platforms; `prove-seeds.ts --only RT-09` | green on macOS (`ps -o lstart`) and Linux (`/proc/<pid>/stat`); seeds (no reaping, start time ignored, group outlives its child) each red, green when restored |
| HO-02 | verified | `mostra/initialize` over both transports: offered `2025-01-01, 2026-10-10, 2099-12-31, not-a-revision` gives `2026-10-10`; offered `2020-01-01` gives -32000 `MOSTRA_HOST_REVISION_UNSUPPORTED` naming the supported revision, and a retry on the same connection succeeds. With three supported revisions in-process, the newest common one is picked. Capabilities, ports (`ai` and unknown ports warn), initialize order, -32700, batch -32600, -32601, -32602, `MOSTRA_HOME_MISMATCH` and `instance/status` in the same suite | `test/integration/protocol-suite.test.ts`, `test/unit/protocol-server.test.ts`, `packages/protocol/test/rpc.test.ts` and `session-methods.test.ts`; CI run [38120269565](https://github.com/mostra-dev/mostra/actions/runs/38120269565); `prove-seeds.ts --only HO-02` | 14 suite tests green over stdio and the socket on both platforms; seeds (oldest revision picked, unsupported revision accepted) red, green when restored |

The ledger requirements of the scope are proven by `test/unit/ledger.test.ts`: WAL with `synchronous=FULL`; an exclusive lock another process can't read through, released on close; migration with a `VACUUM INTO` backup that holds the old schema and data; a failing migration rolls back completely and keeps the backup; `MOSTRA_HOME_TOO_NEW` naming both versions; `MOSTRA_HOME_LEDGER_UNREADABLE` for a non-database and a non-Mostra database, never replaced; `MOSTRA_HOME_DISK_FULL` with nothing committed; `MOSTRA_HOME_GONE` for a removed ledger (red before the fix: SQLite kept writing into the unlinked file).

The `integration` job took 1 min 10 s on Linux and 1 min 22 s on macOS in run [38120269565](https://github.com/mostra-dev/mostra/actions/runs/38120269565); the whole pull request run stayed under the 10-minute target (D50).

## Untested boundaries

- A supervisor killed between spawning a child and recording it (a few milliseconds) leaves that child unrecorded. Node children still exit on the IPC disconnect; a command child started in that window would survive.
- macOS start times have one-second resolution. A process that reuses a reaped group's ID within the same second as the recorded leader could be signalled; Linux uses clock ticks.
- Reaping signals by PID and start time read at one moment; a member that exits and whose PID is reused between the listing and SIGTERM would be signalled. The SIGKILL pass re-checks identities.
- `$XDG_RUNTIME_DIR` handling is tested with directories the test creates; a real logout removing it is simulated by deleting the socket.

## Agent-facing prose (D88)

Waiting for Mirza's review: the hints of `MOSTRA_HOME_LOCKED`, `MOSTRA_HOME_NOT_OWNED`, `MOSTRA_HOME_SOCKET_TOO_LONG`, `MOSTRA_HOME_TOO_NEW` and `MOSTRA_PLATFORM_UNSUPPORTED`, and `packages/runtime/AGENTS.md` in full. The other codes' text, `packages/protocol/AGENTS.md` and the playbook step are delegated (D88).
