# Mostra failure, recovery and concurrency model

**Status:** Settled v1 behavior (C03-A). It covers every case STANDARDS requires: invalid or missing configuration, partial persistence, timeouts, cancellation, process crash, duplicate execution, stale versions, concurrent tabs and clients, host unavailability and unsupported platforms. Each row names the observable behavior and the owner. The evidence matrix maps rows to tests.

## 1. Rules that every case follows

1. **Durable before acknowledged.** A mutation, submission, run start, push or publish is acknowledged only after its ledger transaction commits (`synchronous=FULL`, D71). A client that saw a success can rely on it after any crash.
2. **One writer.** Only the supervisor writes the ledger. Children send requests over IPC and never hold ledger state. Concurrency is resolved inside one transaction, never with in-memory locks spread across processes.
3. **Idempotent by stable IDs.** Every retryable request carries a stable ID (mutation ID, request ID, submission ID, delivery ID, run key). Replays return the recorded result.
4. **Fail closed** where pretending would corrupt state, lose input, leak data or mislead (STANDARDS). Typical cases: a submit that can't be made durable, a token check that can't be evaluated, a ledger that can't be opened, a version that can't be resolved.
5. **Say what happened and what to do.** Every failure surfaces as a diagnostic with a stable code and a hint (INTERFACES §13): to the agent as JSON, to the viewer as plain words in the shell.

## 2. Processes

| Failure | Behavior |
|---|---|
| Two supervisors start for one home | Ownership is the ledger's exclusive SQLite lock, taken before the socket (D81). The first starter to take it owns the home; the lock fails at once for the others. A daemon starter that loses reads `instance.json` and attaches to the socket recorded there, waiting a bounded time while the owner finishes starting. Only when that socket can't be reached does it fail with `MOSTRA_HOME_LOCKED`, naming the owner's PID and how to restart it. `mostra host` never attaches: it gets `MOSTRA_HOME_LOCKED` naming the owner's PID (prototype: 3 × 16 racers, one winner each) |
| Stale socket after a crash | The operating system released the dead supervisor's lock. The next starter takes it, unlinks the leftover socket file and binds a new one. No takeover mutex is needed, because only the lock holder touches the socket. A stale `instance.json` (its PID and start time match no live process) is replaced |
| Socket file removed while the supervisor runs (for example a Linux logout removing `$XDG_RUNTIME_DIR`) | The supervisor checks its socket at least every 10 s and re-creates it. Until then, starters find the owner through `instance.json`, and no second supervisor can start because the lock is held |
| Supervisor crashes or is killed | Children notice the IPC disconnect, signal their own process group and exit. Process groups make sure grandchildren (demo servers, PTY programs) die too; a child that runs programs in their own sessions (the PTY host) registers them with the supervisor. On the next start the supervisor reaps every recorded `child` row: when the recorded leader's PID and start time still match, or the leader is gone and the machine hasn't rebooted, it signals the group's members that started no earlier than the leader (SIGTERM, then SIGKILL). A PID now held by an unrelated process is left alone. Committed state is intact, and in-flight requests were unacknowledged, so clients retry them by ID |
| Worker crashes, OOMs or hangs | Crash or heap exhaustion: the exit is detected. A hang: the 10 s event-loop watchdog kills it. Running action runs end `failed` with reason `interrupted`, and their pages see it. `worker.crashed` is appended. The next request restarts the worker with exponential backoff (1 s to 60 s). Other artifacts and the gateway are unaffected (RT-04; prototype: crash, OOM and hang each isolated) |
| A worker crashes repeatedly (more than 5 crashes in 10 minutes) | The worker is parked. Requests return `MOSTRA_RUNTIME_WORKER_PARKED` (503) with the last cause, `worker.crashed` records `parked: true`, and the shell shows "This artifact's server code keeps crashing" (from the frame ticket's `serverParked` and the event). `verify`, the next publish of the artifact (a republish of the same source too) and a restart of the instance clear the park (D133) |
| A worker answers nothing at all (its process stopped, its channel congested) | Its channel thread answers the watchdog even while artifact code blocks the event loop, so silence is a different failure: after three silent watchdog periods in a row it is stopped as hung ("it answered nothing for N s"), and a single missed ping, such as one queued behind a large result, stops nothing (D133) |
| A watchdog stop while the heap is near its limit (80 % or more) | Reported as out of memory: near the limit, garbage collection stalls the event loop before the heap gives out (seen on Linux) |
| A plain call's or a run's result grows past 16 MiB | The worker's call is cancelled and the call or run ends `MOSTRA_ACTION_TOO_LARGE` (`too-large`); arguments past 16 MiB are refused (413) before a worker sees them (D131) |
| A worker can't be started (its version is damaged, the runtime lacks `@mostra/worker`, its bundle throws while loading) | The call or run fails with `MOSTRA_RUNTIME_WORKER_CRASHED` naming why, and counts as one crash for backoff and parking, its kind (`oom` while loading) included (D136) |
| Builder or verify runner crashes | The operation fails with `MOSTRA_BUILD_CRASHED` or `MOSTRA_VERIFY_CRASHED` plus the child's last stderr lines. Nothing is published. The next operation starts a fresh child |
| PTY host crashes | Live terminals show "Session ended unexpectedly", recordings keep their bytes up to the crash, and a reconnect starts a new PTY host. Other features are unaffected |
| Demo dev server exits | `<WebDemo>` shows the exit code and the last log lines. `mostra open` or a reload restarts it |
| CLI version differs from the daemon's | Protocol negotiation picks the highest common revision. If none exists, the CLI reports `MOSTRA_HOST_REVISION_UNSUPPORTED` with `mostra daemon restart` as the fix. Restarting is safe: everything durable survives, and open views reconnect |

## 3. Persistence

| Failure | Behavior |
|---|---|
| Crash during publish | Staging and build outputs are written outside `versions/`, and promotion is an atomic rename followed by the ledger transaction. A crash before the transaction leaves no visible version (VR-02). The orphaned directory is removed on the next start, because no ledger row names it |
| Crash during a package install | A lock layout counts only once it carries its `.mostra-layout` marker, so the next start removes an unfinished one and the scratch projects of resolutions in progress (`deps/tmp/`). The artifact's working lockfile changes only after its layout is complete, and the store keeps whatever finished downloading |
| Crash between the version rename and the ledger insert | Same as above: the version directory isn't visible without its row, and a later publish of the same digests reuses the directory after checking it |
| Disk full | The transaction fails and the client gets `MOSTRA_HOME_DISK_FULL`. The viewer's unsaved edits stay in the browser journal (§5). Nothing partial is committed |
| Ledger can't be opened (corrupt, unreadable, or not a Mostra ledger) | The supervisor refuses to start with `MOSTRA_HOME_LEDGER_UNREADABLE`. `mostra doctor` runs SQLite's integrity check (through the supervisor, or only when no supervisor holds the lock, D81) and points to the latest backup. Mostra never recreates an empty ledger over an existing file |
| Ledger is newer than the runtime | `MOSTRA_HOME_TOO_NEW` names the schema version and the runtime version that wrote it (DATA_MODEL §6) |
| Migration fails part-way | The migration transaction rolls back, the ledger stays at its old version, and the backup taken before it remains next to the ledger |
| Blob or version file missing or altered | Reads verify content hashes. A mismatch is `MOSTRA_HOME_INTEGRITY` naming the object. The viewer sees "This version is damaged", and the agent gets the code. Publishing the version's source again checks the stored directory against its recorded output digest and rebuilds a missing or altered one in place, under the same version ID and number (WP-03) |
| Home directory removed while running | Writes fail closed. The supervisor checks its home at least every 10 s; when the home is gone it stops accepting requests, answers them with `MOSTRA_HOME_GONE`, stops its children and exits |
| Home owned by another user | Every entry point fails closed with `MOSTRA_HOME_NOT_OWNED` before using it, because the home holds secrets (D44). A home the user owns is tightened to mode 0700 (D85) |
| Control socket path too long for the operating system | `MOSTRA_HOME_SOCKET_TOO_LONG`, naming `MOSTRA_RUNTIME_DIR` as the fix (D82) |

## 4. Submissions and delivery (IN-05, IN-12, IN-13)

**Delivery states:** `pending` → `delivered`. On a terminal rejection: `rejected`, or `undeliverable` for a host-declared terminal reason.

| Case | Behavior |
|---|---|
| Duplicate submit (double click, retry, second tab) | Same request ID or same view and revision: the existing submission is returned. A different view under `once`: typed conflict `MOSTRA_SUBMIT_ALREADY` with the existing submission (H-02). The shell shows "Already submitted" with its time |
| Submit with a stale expected revision | The shell flushes pending saves first. If the server's revision still differs, the submit fails with `MOSTRA_SUBMIT_REVISION_MOVED`, and the shell reloads the draft so the viewer sees exactly what will be sent before confirming again. Invariant: a submission is never made from content the viewer didn't see |
| Submit from an older version's view | Accepted, bound to the version shown, `staleView: true`, with the newer version's number recorded (H-10) |
| Policy `none` | Submit is unavailable, and the shell shows no Submit control. An API call returns `MOSTRA_SUBMIT_POLICY_NONE` |
| Required fields missing | Refused before the transaction, with blockers listed by label |
| Host down when the viewer submits | The submission commits, deliveries stay `pending`, and the viewer sees "Submitted. Pending delivery to <host>". The dispatcher retries with backoff (1 s, doubling to 5 min) while the host is registered, or expected through `HomeConfig.ports`. When the host connects and registers the port, pending deliveries replay in submission order |
| Host accepts, then Mostra crashes before recording it | On restart the delivery is still `pending` and is redelivered with the same `deliveryId`. The host must treat the ID idempotently, and the conformance kit tests that (H-03) |
| A submission's envelope would be longer than one protocol message (64 Mi characters) | Never sent, since the host couldn't read it and every later delivery to that host would wait behind its retries: the delivery is `undeliverable` with reason `too-large: …`, at once. Snapshots are bounded (DATA_MODEL §3), so this is a last defense |
| Host answers `accepted: false, retry: false` | `rejected` (or `undeliverable` when the reason is `undeliverable`; `delivered` when it is `duplicate`, since the host already holds it, D105). The viewer sees the host's reason, and the event is appended. Mostra never retries a terminal answer, and a trigger keeps it final |
| No host takes submissions | The submission goes to Mostra's built-in adapter, which accepts it at once (D58, D105); a host registered or expected (`HomeConfig.ports`) at submit time gets its own delivery |
| Host port call hangs | A 30 s timeout per call counts as a retryable failure |
| Viewer closes the tab right after submitting | Nothing is lost. Delivery is independent of the page. Reopening shows the current delivery state |
| Agent waits during all of this | `wait --until submitted` is satisfied at commit time, whatever the delivery state. "Accepted by Mostra" and "accepted by the host" are separate facts (seed §7) |

## 5. Fields, tabs, devices and offline (IN-01 to IN-04)

| Case | Behavior |
|---|---|
| Two tabs edit different fields | Both mutations apply, because rebase is per field. Each tab receives the other's change on the event stream (BroadcastChannel only shortens the delay) |
| Two tabs or devices edit the same field | The second mutation's base `field_rev` is stale, so it returns a conflict for that field and applies the rest. The writer's field `meta.conflict` offers "keep mine" (a new mutation on the current revision) or "take theirs". Nothing is overwritten silently |
| An agent writes artifact state while a viewer edits the same field | Same rule. The agent's `state/patch` returns `conflicts`, and the viewer's field shows "Changed by <agent>" with the choice (D63) |
| Network drops | Edits go to the IndexedDB journal with their mutation IDs and base revisions, and the field shows `offline`. On reconnect the journal replays in order. Accepted mutations clear, conflicts surface per field, and replays of already-applied IDs return their recorded result |
| The journal holds edits for a version that has since been replaced | Edits replay against their own version's field IDs. Fields missing in the newer version become orphans (D42). Mostra never maps them silently by position |
| Page closed with an unsaved debounce | `pagehide` and `visibilitychange` flush. If the flush can't be sent, the journal holds the edit and replays it the next time any page of that artifact opens in that browser (IN-02) |
| Mutation retried after a timeout | The mutation ID replays the recorded result (IN-01) |
| Field value too large | `MOSTRA_FIELD_TOO_LARGE`. The value is kept locally and not truncated |

## 6. Actions and live data (AC-01 to AC-08)

| Case | Behavior |
|---|---|
| Double click, two tabs or a reload with an explicit key | One run per (artifact, action, key). Later calls join it and stream the same progress and result (AC-03) |
| Double click without a key | Calls join the hook instance's in-flight run. After it finishes, a new click starts a new run, as the author intended |
| Cancellation | The run's `AbortSignal` fires. The run ends `cancelled` if the action stops, or reaches whatever final state the action itself returns (AC-04): an action that ignores the signal and returns ends `succeeded` with its result, so a page never shows "cancelled" for a mail that was sent; a streamed result a cancel cut short ends `cancelled` (D136) |
| A page sends arguments that would outlive the call (symbol names, which `Symbol.for` keeps for the life of the process), a bigint of more than 10,000 digits, an async iterable, or a promise the batches never settle | Refused with 400 `MOSTRA_ACTION_UNSERIALIZABLE` before a run is recorded or a worker sees them; the worker's reader refuses them again. One link holder can't fill a worker's heap and park an artifact for every viewer (D136) |
| A page names a function its version doesn't have | 404 `MOSTRA_ACTION_UNKNOWN_FUNCTION`: no run is recorded, no key spent, no worker started (D130) |
| A version's package layout was removed, or the warm set moved on, before its worker starts | The layout is installed again from the home's store, or a pinned layout with the version's locked warm packages, before the worker starts (D135). Offline with a package the store lacks: `MOSTRA_DEP_OFFLINE` naming it, and the start backs off like a crash |
| Worker crash during a run | `failed` with reason `interrupted` and `MOSTRA_ACTION_INTERRUPTED` naming the cause, no retry (D24). Runs still open when the instance starts (it crashed or was killed) end the same way. An action with external effects should use the provider's own idempotency key. The docs say so, because Mostra's de-duplication covers invocations, not the side effects of a run killed mid-flight |
| An action never returns | Allowed: actions may run long. A busy loop trips the event-loop watchdog. An action awaiting forever just stays `running` until it's cancelled or its worker is evicted (eviction waits for running actions) |
| `verify` meets an action | Invoked only if the action opts in through `dryRun()`. Otherwise the call is skipped and reported (D55) |
| Missing secret | `secret()` throws `MOSTRA_SECRET_MISSING` naming the secret and the `mostra secret set` command. The run fails with that code |
| Host's `secrets` port fails or doesn't answer in 30 s | `secret()` throws `MOSTRA_SECRET_MISSING`; it never falls back to the home's store for a host that took secrets over (D131). A host that isn't connected isn't asked |
| A run's or live update's message is lost (a dropped stream, a full queue) | Updates are ephemeral (D130): the page sees a gap in a run's offsets, a skipped live revision or a reconnect, and reads the run or source again; the ledger holds the truth |
| A keyed run failed | The key stays taken: the run happens at most once (D130), and a page shows its failure. A new attempt takes a new key |
| A `watch` source's file event is missed | The worker also compares the matched files every 2 s (D131, VERIFIED_FACTS WP-08), so the change loads at most that late |
| A daemon has nothing to do | It exits 0 after 30 minutes (D133), unless it runs `--always-on` as the login service or its home has a login service installed |
| Live producer throws or its source is unreachable | The last good value stays, `useLive` exposes `error` with the code, and the producer retries on its schedule. Viewers never see a blank state for a transient error |
| Push to an unknown key | Accepted: pushes create sources (D56). A push whose value exceeds 4 MiB is refused with a code |
| High-rate pushes | Values coalesce: a slow reader's queued values of a source in latest mode give way to its newest, on the server and in the page, which decodes only the newest waiting value and renders at most once per animation frame. Append mode keeps every value, bounded by the ring (AC-08, D136) |
| A home holds thousands of artifacts | Live producers reconcile from an in-memory list of the artifacts whose latest versions have live sources, kept up to date on publish, so a reconcile costs nothing per artifact without them and the supervisor keeps answering (D136) |

## 7. Versions and stale clients

| Case | Behavior |
|---|---|
| New version published while a view is open | The banner appears, with the orphan count. A following viewer switches automatically, unless unsaved edits or orphans would result (D63) |
| Old version's client runtime meets a newer gateway | The gateway serves every browser-protocol revision it ever shipped. Removing a revision needs a 12-month deprecation and a new major version (D32) |
| `mostra gc` | Collects only versions referenced by no submission, view, review set or follow (VR-06). A dry run lists what it would remove |
| Artifact source moved or deleted after publish | Versions, submissions and results stay readable from `sources/` and `versions/` (HO-08). The next publish from a new path binds by manifest `id` |

## 8. Network, sessions and addressing

| Case | Behavior |
|---|---|
| Event stream drops | The client reconnects with its cursor and receives every durable event after it. If SSE fails twice in a row, the client switches to long-polling (D47) |
| Daemon restarts while views are open | Same as a drop. Ports are leased, so URLs keep working. Sessions are durable rows, so viewers stay signed in |
| Leased port taken by another program | The gateway leases a new port, records it and logs `MOSTRA_ENV_PORT_TAKEN`. Existing URLs for that artifact stop working, and `mostra open` reissues them. When the shell's port moves, every link minted for the old address answers 410, since the program on that port could read their secrets, and the next publish receipt carries a default link at the new address (D97 item 10). `mostra doctor` names the conflicting process where it can |
| Token expired or revoked | 410 with `MOSTRA_HYGIENE_TOKEN_REVOKED`. The shell explains "This link was revoked or has expired" and keeps any unsaved local edits in the journal (HY-03) |
| Bad Host, bad Origin, missing token or missing CSRF header | 403, 421 or 401 with a code, logged without the request's capability material (HY-01) |
| Guessing a token | Past 30 failed tokens for one artifact in a minute, every token for it gets 429 with `Retry-After`, a right one too; other artifacts' links keep working (D97 item 8) |
| Another link opened for an artifact this browser already has open | The shell shows what each link allows and asks which to keep; nothing is replaced until the viewer chooses (D98 item 8) |
| A page fills the host's cookie jar | Up to 1 MiB of headers, more than browsers keep per host, is served. Past that, 431 `MOSTRA_HYGIENE_HEADERS_TOO_LARGE` with a page that clears the host's cookies; the viewer opens the link again (D98 item 9) |
| A version's files altered or removed while the gateway runs | The next request for one of its files checks the version again and answers 500 `MOSTRA_HOME_INTEGRITY` until a republish rebuilds it (§3, D98 item 5) |
| Tunnel drops | Viewers over the tunnel reconnect when it returns. `mostra share` reports the drop. Public shares never fall back to a wider bind |
| Worker-mode frame bootstrap fails (service worker blocked) | The shell shows `MOSTRA_HYGIENE_FRAME_SESSION`, with the reason and a suggestion to open the tailnet or Funnel link instead (D70) |

## 9. Timeouts

| Operation | Default | On timeout |
|---|---|---|
| `wait` | caller-chosen (CLI) or 50 s at most per MCP call | `still_waiting` with a cursor and nothing lost (IN-10) |
| `verify` | 120 s for every stage after compile, the baseline's render included; the smoke test 60 s or 200 interactions; installs keep their 300 s and the build its 180 s, with the type check beside the build inside the same 180 s (D138) | Partial verdict with `MOSTRA_VERIFY_TIMEOUT` (an error) and the stage reached; a smoke test at its budget stops with a hint and nothing else |
| Build | 180 s | `MOSTRA_BUILD_TIMEOUT` |
| Package install | 300 s, or immediate when offline | `MOSTRA_DEP_TIMEOUT`, or `MOSTRA_DEP_OFFLINE` naming the package (DP-04) |
| Port calls to hosts | 30 s | Retryable failure (§4) |
| Protocol requests from clients | none by default; the client sets `timeoutMs` | The client abandons the request; durable effects keep their IDs |

## 10. Configuration and platform

| Case | Behavior |
|---|---|
| Manifest isn't a literal, or is invalid | `verify` and `publish` report `MOSTRA_MANIFEST_*` with the location and a fix. Unknown keys are warnings, so manifests evolve additively |
| Unknown import with `dependencies: "explicit"` | `MOSTRA_DEP_MISSING` with the exact `mostra add` command (D43) |
| Package lifecycle script fails | The install fails with `MOSTRA_DEP_INSTALL_FAILED` and the script's output; nothing is published. It runs in an install child with the artifact's directory and environment, never in the supervisor (DP-05) |
| Registry unreachable, or a package the store lacks while offline | `MOSTRA_DEP_OFFLINE` naming the package; with `MOSTRA_OFFLINE` set or no network interface up, the supervisor answers from its store index before any child starts (DP-04). Everything the store holds keeps building, including rebuilds of published versions |
| No such package or version, or only releases younger than a day for a spec without an exact version | `MOSTRA_DEP_NOT_FOUND` with the registry's answer (D95) |
| Unsupported platform (Windows until WP-32 adds it in v1.1, D120; other architectures) | Every entry point fails closed with `MOSTRA_PLATFORM_UNSUPPORTED` before touching the home (D35). `mostra-runtime host` also answers the host's first request with it, so a spawning host gets a typed error |
| No browser available for `verify` | `MOSTRA_ENV_BROWSER_MISSING` with the install command. The runtime bundle includes the headless shell, so this means a damaged bundle |
| Required tool missing for sharing | `MOSTRA_SHARE_TOOL_MISSING` with install instructions (D47) |

## 11. Remote server, relay and teams

The plan update of 2026-10-16 adds failure cases that later packages define. Each is a *Deferred decision* for the package named, which adds its rows here; the rules of §1 hold for all of them.
- **WP-28** (D116, D117): the owner offline (pages, drafts, submissions and comments keep working; action runs wait or fail per the artifact's offline policy; live sources show their last value with its time), relay loss mid-run, a remote server restart, sync gaps between an owner's instance and a remote server, and exhaustion of an operator's limits.
- **WP-31** (D121): roster changes while a wait is pending, and presence traffic over its rate.
- **WP-32** (D120): the platform cases of §10 for Windows.
