# @mostra/runtime

The supervisor that owns a Mostra home: its ledger, its control socket, the host protocol server and
every child process. Audience: the runtime bundle. `mostra-runtime host|daemon` (`src/bin.ts`) is
the bundle's entry point (D85); it never runs artifact code (RT-02).

## Invariants it owns

- **One owner per home (D81, RT-06).** The home's owner holds the ledger's exclusive SQLite lock,
  taken before anything else. The socket and `instance.json` only help others find the owner;
  never use either as a lock.
- **The ledger has one writer (D58, D71).** Only `ledger` opens `store/ledger.sqlite`, and nothing
  else in the process opens that file: POSIX drops the lock when any descriptor for it closes.
  Every write is one `Ledger.write` transaction, durable before it returns, and fails closed with
  `MOSTRA_HOME_GONE` when the file was removed.
- **Migrations only move forward.** Append a migration to `src/ledger/migrations.ts` and never edit
  a released one. Opening backs the ledger up first; a newer ledger is `MOSTRA_HOME_TOO_NEW`.
- **Every child goes through the process manager (RT-09).** `ProcessManager.spawn` starts it as
  the leader of its own process group and records it in `child` before anyone relies on it. A
  child that starts a program in its own session (a PTY) adopts it with `child/adopt`.
- **Children die with their supervisor.** A Node child connects with `connectToSupervisor`, which
  ends its process group when the IPC channel disconnects. Packages that can't import this one
  (`@mostra/worker`, `@mostra/pty-host`) implement the same rule.
- **The platform gate runs first (D35, RT-07).** No entry point touches the home before
  `checkPlatform` passes.
- **No secret reaches a log or a report.** Every string the log writes passes through the
  instance's `Redactor`, and child output is redacted before it is kept. Pass the secrets a child
  receives in `SpawnSpec.redact`; variables named like secrets are redacted on their own.
- **Hosts reach the instance only through the protocol (D59).** Methods are defined in
  `@mostra/protocol` and served through `ProtocolServer`; port calls go only to the connection that
  registered the port.

## Where things are

`src/index.ts` is the public interface; `etc/runtime.api.md` is its API report. Modules each have
one `index.ts`, and imports between them go only through it (REPO_STANDARDS §3):

| Module | Owns |
|---|---|
| `home` | Platform gate, home and runtime-directory resolution, permissions, the socket name, taking the lock or finding the owner, `instance.json` |
| `ledger` | The SQLite ledger: lock, pragmas, migrations with backup, integrity, error mapping |
| `processes` | Process identity (PID plus start time), the process manager, reaping, the child side of IPC |
| `protocol-server` | The JSON-RPC dispatcher for stdio and the socket, session rules, the session methods |
| `instance` | The composition root: start-up and stop order only, no policy |

`src/log.ts` is the supervisor's JSON-lines log in `<home>/logs/`.

To serve a new protocol method, define it with `pnpm gen protocol-method` in `@mostra/protocol`
([playbook](../../docs/agents/add-protocol-method.md)), implement it in the module that owns its
behavior, and pass a `handler(definition, fn)` to the `ProtocolServer` that `instance` builds.
`handler` lives in `protocol-server/server.ts`; export it from the module's `index.ts` when the
first module outside `protocol-server` needs it.

## Tests to run

- `pnpm --filter @mostra/runtime test`: unit tests in-process (`test/unit`).
- `pnpm --filter @mostra/runtime build && pnpm --filter @mostra/runtime test:integration`: the
  built binary as real processes (`test/integration`): the protocol suite over stdio and the
  socket, racing starters, stale sockets, reaping after SIGKILL, the platform gate. CI runs them on
  macOS and Linux (`integration` job, D86).

## Gotchas

- Integration tests run `dist/bin.js`; rebuild after changing `src` or `@mostra/protocol`.
- Linux differs from macOS in process listings, signals and `/bin/sh` (`dash`). Run process and
  socket changes on Linux before pushing ([playbook](../../docs/agents/reproduce-on-linux.md)).
- Keep test sockets under `/tmp` (`tempDir(prefix, true)` in `test/support.ts`): macOS limits
  socket paths to 103 bytes, and its `os.tmpdir()` is long.
- `net.Server.close()` removes the socket file. Close an old listener before binding its
  replacement.
- macOS start times have one-second resolution; compare them only with `startedNoEarlier` and
  `sameBoot` in `processes/identity.ts`.
- A killed process can linger as a zombie until init reaps it. Tests wait for it with
  `eventually`, never with a single check.
- Keep a strong reference to an open better-sqlite3 `Database`: garbage collection closes it and
  drops the home's lock.
