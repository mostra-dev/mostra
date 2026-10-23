# mostra-win

Mostra's Windows platform helper (WP-W1, RT-10): what the runtime can't do on Windows through
Node.js. Audience: the runtime bundle (the runtime's `platform` module runs it; WP-W3 ships it in
the Windows bundles). Unpublished. Depends on `windows-sys` and `serde_json` only.

## Invariants it owns

- **Owner-only means the user and `SYSTEM`, set at creation (D44, D85).** `secure-dir` creates a
  directory with a protected access list that grants only the current user and `SYSTEM`,
  inherited by everything inside. Over a wider tree the user owns it resets the directory and
  every entry below that grants anyone else anything, one entry at a time through a handle on the
  entry itself, never through a junction or link, and leaves narrower lists alone, so a sealed
  version stays sealed ("bypass traverse checking" lets anyone open a file whose own entries
  allow it). A directory owned by someone else is refused, never changed. `seal` and `unseal`
  walk a version the same way.
- **The control pipe admits only its owner (D81, D82).** `pipe` creates `\\.\pipe\<name>` with an
  owner-only descriptor, `FILE_FLAG_FIRST_PIPE_INSTANCE` (no one else can hold the name) and
  `PIPE_REJECT_REMOTE_CLIENTS`, and forwards each client over its descriptor 4 in frames
  (`[connection u32 LE][kind u8][length u32 LE][payload]`: OPEN 1, DATA 2, CLOSE 3, READY 4,
  FATAL 5). When the supervisor's end closes, or it sends CLOSE on connection 0, it hands every
  client what it was already sent (at most 5 s), then exits. Clients connect through `connect`,
  which refuses a pipe another user owns before a byte is relayed: another user can create a pipe
  under a name no instance serves at the moment.
- **A child runs only once it is recorded (issue #7, D93).** `gate` creates its command suspended
  inside an unnamed kill-on-close job (`PROC_THREAD_ATTRIBUTE_JOB_LIST`, so the child is never in
  no job of the gate's), then in a Job Object of its own (kill-on-close, named
  `Local\mostra-job-<pid>-<creation time>`, in the logon session's own namespace),
  passes the C runtime's descriptor table on (descriptor 3 blanked, so Node.js's IPC channel on 4
  reaches the child), reports `{pid, startTime, job}` on descriptor 3 and resumes the child only
  on "go". Descriptor 3 is the child's lifeline: when it closes, the job ends, descendants
  included. It exits with the child's exit code, or 125 when never released. The gate and the
  pipe's helper ignore console Ctrl+C and Ctrl+Break: only the supervisor handles them.
- **Identity is PID plus creation time.** `identity`, `processes` and `reap` read `GetProcessTimes`
  (`win/<100 ns since 1601>`); `reap` ends a recorded child's job and the child only when the
  running process's creation time matches the record, so a reused PID is never touched; when the
  job's name can't be opened (another logon session's), it ends the child's descendants, each a
  child of its parent only when created after it.
- **`unsafe` lives in `src/win/sys.rs` only**, each call with a SAFETY note; the workspace's
  `unsafe_code = "forbid"` is relaxed to `deny` for this crate alone.

## Public interface

The binary's commands, listed with their JSON answers in `src/main.rs`. `mostra-win-probe` (test
only, never shipped) opens paths and pipes as another user (`as-user`), holds a
pipe as another user (`squat`), prints a path's descriptor (`security`), and freezes or thaws a
process (`suspend`, `resume`) for RT-10's checks.

## Tests to run

The helper runs only on Windows, so its behavior is checked through the runtime's suites on the
Windows CI legs (`packages/runtime/test/integration/windows.test.ts` and the `windows` group).
Locally: `cargo clippy -p mostra-win --target x86_64-pc-windows-msvc --all-targets -- -D warnings`
and the same for `aarch64-pc-windows-msvc` ([playbook](../../docs/agents/run-on-windows.md)).
