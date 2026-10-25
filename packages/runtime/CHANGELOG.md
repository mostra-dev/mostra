# @mostra/runtime

## 0.5.0

### Patch Changes

- [#75](https://github.com/mostra-dev/mostra/pull/75) [`5afc703`](https://github.com/mostra-dev/mostra/commit/5afc70310653dabcf886df19d1a19754bf3290aa) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - When an artifact's server code keeps crashing and its worker is parked, every live source of that version now says so (`MOSTRA_RUNTIME_WORKER_PARKED`). Before, a source whose producer was still starting at the last crash showed a generic failure, or nothing at all, and its page waited without a word ([#42](https://github.com/mostra-dev/mostra/issues/42)).

- [#75](https://github.com/mostra-dev/mostra/pull/75) [`e48e7aa`](https://github.com/mostra-dev/mostra/commit/e48e7aad93787e3f2a8e41c6088239bcc2f11178) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Security updates: Vite 8.3.3 for the builder (its `launch-editor` could be led to run a command on Windows, GHSA-587h-7wmj-h5pm), Zod 4.6.6 for every wire schema (validating an oversized constrained collection could exhaust memory, GHSA-mrhx-c7xc-m3w5), and undici 8.12.2 for the SDK's bundle downloads (unbounded memory in its EventSource parser, GHSA-4qv8-2p9j-2685).
- Updated dependencies [[`7893700`](https://github.com/mostra-dev/mostra/commit/78937009ac67a4780b3c29017b5e84dd818d6f75), [`c3c0052`](https://github.com/mostra-dev/mostra/commit/c3c0052183bcc02b27d755001419d1e55a3a8e7f), [`e48e7aa`](https://github.com/mostra-dev/mostra/commit/e48e7aad93787e3f2a8e41c6088239bcc2f11178)]:
  - @mostra/protocol@0.5.0

## 0.4.0

### Minor Changes

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`dbcfc31`](https://github.com/mostra-dev/mostra/commit/dbcfc31ff3bbb75a95d013317a528e6be3a16ea7) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On Windows (still behind `MOSTRA_DEV_WINDOWS=1`), `mostra-runtime service install` registers the home's daemon as a Task Scheduler task at the user's logon, run without a window by `mostra-win-service.exe` beside the helper, which restarts it 10 s after an unexpected exit; `service uninstall` stops the daemon cleanly and removes the task. `service status` reports, on Windows, whether Task Scheduler holds the task (`registered`). A worker that ends with a Windows status reports it in hexadecimal (`0xC0000005`).

### Patch Changes

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`182e47d`](https://github.com/mostra-dev/mostra/commit/182e47d28a3659fbd1a5df3144e020a344f75d19) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra dev` keeps React Fast Refresh on Windows, where it recognises the entry as Vite names it (`C:/…`); it mirrors a file an editor holds or is saving on the next sync instead of losing the change, removes a file from the preview only when two syncs in a row miss it (an editor that moves the old file aside before writing the new one), titles a source without a manifest as publish does, and removes a session's directory through the platform layer, which rides out a file Windows still holds for a moment.

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`a3f895a`](https://github.com/mostra-dev/mostra/commit/a3f895af2fc3a86cc974aa288a8f7053aa0206b0) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - An instance recognises its home however a client spells it: on Windows a short (8.3) name such as `C:\Users\RUNNER~1\…` or another case no longer refuses the session with `MOSTRA_HOME_MISMATCH`, and `mostra-runtime service` names the login service by the home as the daemon spells it.

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`f65a3ff`](https://github.com/mostra-dev/mostra/commit/f65a3ff0d3440573b7848ff9c6f752f9ee64e2da) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The gateway reads and drops what a client is still sending after refusing its request (for at most 5 s and 16 MiB) instead of letting the connection close at once. A client that read its answer only after sending everything (a browser sending a megabyte of cookies, on Windows above all) got a reset instead of the page that clears its cookies.

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`e9e52ec`](https://github.com/mostra-dev/mostra/commit/e9e52ec435f7847b96635e1e9bada74543b76602) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On Windows, the login service's daemon stops in order when the user's session ends. `mostra daemon uninstall` stops it in order from any logon session, and removes the task even when the home lost its definition. A task removed in Task Scheduler no longer keeps a hand-started daemon from its idle exit. The launcher's stop event has a random name, and the launcher refuses an event that another user created under it. A home is compared by its exact native real path, so two directories NTFS keeps apart are never the same home.
- Updated dependencies [[`fe84a16`](https://github.com/mostra-dev/mostra/commit/fe84a160c095c6dfe29f3ed5c956ae36407c788f)]:
  - @mostra/protocol@0.4.0

## 0.3.0

### Minor Changes

- [#54](https://github.com/mostra-dev/mostra/pull/54) [`bb00a14`](https://github.com/mostra-dev/mostra/commit/bb00a1474c4737e800d5c38824c3250fe3b43890) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The runtime gains a platform layer and runs its supervisor, ledger, builder and dependency store on Windows x64 and arm64, behind the development switch `MOSTRA_DEV_WINDOWS=1` until Windows support is complete: the home defaults to `%LOCALAPPDATA%\mostra` and is owner-only by access control, attached clients reach the supervisor through an owner-only named pipe, and every child runs in a Job Object that ends with it, recorded by PID and creation time. Every other platform still fails closed with `MOSTRA_PLATFORM_UNSUPPORTED`. `ProcessManager` gains `killAll()`, which ends every child at once at the supervisor's exit.

### Patch Changes

- Updated dependencies [[`bb00a14`](https://github.com/mostra-dev/mostra/commit/bb00a1474c4737e800d5c38824c3250fe3b43890)]:
  - @mostra/protocol@0.3.0

## 0.2.0

### Minor Changes

- [#44](https://github.com/mostra-dev/mostra/pull/44) [`8772efe`](https://github.com/mostra-dev/mostra/commit/8772efeaf48e77765e6c3953c213704dd35c8de5) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Hosts can name the people who open their links (D143): a host that registers the `identity` port is asked who a browser is when it exchanges a link minted without a viewer, and the session acts as that person (a viewer of kind `host`). `null` keeps the home's local user; a host that took identity over and can't answer refuses the link with `MOSTRA_HOST_IDENTITY_UNAVAILABLE`. The SDK serves it as `ports.identity.resolve`. The shell explains that refusal to the viewer.

### Patch Changes

- Updated dependencies [[`0ff9ae5`](https://github.com/mostra-dev/mostra/commit/0ff9ae5b682ab9b9d5db42b9984d553ce025428b)]:
  - @mostra/protocol@0.2.0

## 0.1.0

### Minor Changes

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`c37abca`](https://github.com/mostra-dev/mostra/commit/c37abca1b7d39e72781aac0b01e3a81ef20de0e6) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Fixes from WP-08's Claude Opus review (D136). Arguments a page sends can't be registered symbols, async iterables, bigints of more than 10,000 digits or promises that never settle, and are checked before a run is recorded or a worker starts (`checkArgumentFrames`); a typed-array subclass such as `Buffer` crosses as its built-in base. A run whose action returned despite a cancel ends `succeeded` with its result. A page sees only its own viewer's signals from server code, no `host.*` event, `action.*` events only for runs it may see, and `worker.crashed` without its cause. An unknown function answers 404 before anything is recorded. A worker that dies during its start counts as one crash. Results and live values are redacted as values, bytes included; multi-line secrets line by line. A client key joins only a run of its own function. Live producers reconcile without scanning every artifact. Slow readers get coalesced run and live updates, pages render at most once per frame, and `runs/attach` takes `held` so a renewal reads only what is newer (`RunState.logFrom`, `batchFrom`). Migration 7 refuses replacing a run and changing its result batches.

- [#37](https://github.com/mostra-dev/mostra/pull/37) [`532b9c1`](https://github.com/mostra-dev/mostra/commit/532b9c1503a366796be4b6948914648337d429c0) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Run from a runtime bundle (RT-01, D142): verify renders with the bundle's own browser whatever `PLAYWRIGHT_BROWSERS_PATH` the environment names, and the children that run an artifact's own code (package installs and workers) find the runtime's private Node.js first on their `PATH`, so a lifecycle script or server code that runs `node` works on a machine with no other Node.js.

- [#29](https://github.com/mostra-dev/mostra/pull/29) [`ffc9ba5`](https://github.com/mostra-dev/mostra/commit/ffc9ba512599c25636faf88c182ee208c0780394) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Serve the CLI's methods (D140): `view/default`, one-time launch tickets (`view/launch`, exchanged
  by the shell from `#l=`), `instance/check`, and `gc/run`, which keeps every version a submission,
  view, run, session, live value, review set, field, live pinned link, baseline or follow names, and
  collects the rest as tombstones (`version_collected`, migration 9) along with unused snapshots, lock
  layouts, store packages and verify caches, serialized with publish, verify and installs. A home
  that a host spawned or configured is marked `hostConfigured` in `config.json`.
  
  Serve `mostra dev` (`dev/start`, `dev/stop`, `dev/notify`, D140 item 12): a development preview of
  unpublished source in its own sandbox, with Vite's hot updates through the gateway's checks, server
  code that runs for real and restarts when it changes, and submissions reported to the session and
  delivered nowhere. The shell marks it "Development preview, not published".

- [#20](https://github.com/mostra-dev/mostra/pull/20) [`df3b959`](https://github.com/mostra-dev/mostra/commit/df3b95986eebb913dc4e9a51a87d4fd90db7488e) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Serve the shell's trusted controls (WP-07): the shell channel's Submit and Choose, follow and
  carry-over routes on the shell origin, the shell's own event stream, the submit channels in force
  per view from the `trustedControls` port or `HomeConfig.submitChannels` (D108), orphans computed
  against each version's field coverage, which builds now record in `registry.json` (D109), and the
  browser-protocol revision in `envDigest`. Ledger migration 6 adds view controls, follows and each
  field's version number.

- [#12](https://github.com/mostra-dev/mostra/pull/12) [`33d4558`](https://github.com/mostra-dev/mostra/commit/33d4558718bcd9f14f3d80ded0c551cbb2e303fb) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Dependencies (D95): an artifact may import any npm package. Packages outside the warm set install
  on demand through pnpm 10 into the home's shared, content-addressed store, in an install child that
  runs in the artifact's directory with the artifact environment, and are linked into one layout per
  lockfile whose peers resolve to the warm set's single React. Each artifact keeps a working lockfile
  with exact pins, frozen into its version's `lock.yaml` and its `envDigest`, so a version rebuilds
  offline from the store. `deps/add` adds packages; the `explicit` dependency policy refuses other
  imports with `MOSTRA_DEP_MISSING`; offline requests for packages the store lacks fail at once with
  `MOSTRA_DEP_OFFLINE`. The warm set gains the rest of the kit's libraries. A package's undeclared
  dependency can no longer be taken from a `node_modules` above the home. `SpawnSpec.onStdout`
  receives a child's output lines.

- [#14](https://github.com/mostra-dev/mostra/pull/14) [`f9906d5`](https://github.com/mostra-dev/mostra/commit/f9906d507527fc16af18c42d64edc8915dbb7e6b) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add the gateway (WP-05): every instance serves the shell and each opened artifact on stably leased
  loopback ports, turns capability links into origin-bound `HttpOnly; SameSite=Strict` sessions with
  single-use frame tickets, checks every request's Host, Origin, CSRF token, content type and scope,
  and serves published versions straight from disk with no process. `view/url`, `view/rotate` and
  `view/revoke` mint, replace and end capability links; every publish receipt carries the artifact's
  default link; `instance/status` reports where the gateway listens. `mostra-runtime host|daemon`
  take `--bind` and `--url-host` for a wider bind. Every mutating method now refuses a `requestId`
  reused with other parameters (`MOSTRA_HOST_REQUEST_ID_REUSED`) instead of replaying another
  request's result.

- [#6](https://github.com/mostra-dev/mostra/pull/6) [`60c4309`](https://github.com/mostra-dev/mostra/commit/60c4309b5c25606c419ac64e196e41e90bf18c8f) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - First release of `@mostra/runtime`: the supervisor that owns a Mostra home. `mostra-runtime host`
  serves the host protocol over stdio and `mostra-runtime daemon` over the home's socket, with
  `mostra/initialize` negotiation, `instance/status` and `mostra/shutdown`. A home's owner holds the
  ledger's exclusive lock, so racing starters converge on one supervisor and attach to it through
  `instance.json`; the ledger runs SQLite in WAL mode with `synchronous=FULL`, migrations with a
  backup, and fails closed when its file disappears. Every child runs in its own process group, is
  recorded with its PID and start time, and is reaped after a crash. macOS and Linux only; other
  platforms fail closed with `MOSTRA_PLATFORM_UNSUPPORTED`.

- [#16](https://github.com/mostra-dev/mostra/pull/16) [`0f08829`](https://github.com/mostra-dev/mostra/commit/0f088298896bfc2750d155e35846a9a860aa9916) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The interaction ledger (WP-06): drafts and artifact state with per-field compare-and-set and replayable mutation IDs; the submit transaction under `once`, `epochs` and `none`, with write-once submissions bound to the exact version and view; the outbox delivering to hosts' `submissions` ports in order, with backoff and redelivery by `deliveryId`, and draft mirrors; events with filters, durable subscriptions, acknowledgments and compaction; signals; `wait`; results as JSON and Markdown; the host methods `state/get`, `state/patch`, `results/get`, `wait` and `events/*`; and the browser protocol's first revision, `2026-10-15` (`fields`, `submit`, `signal`, `events`, `events/poll`). `view/url` takes a `viewer`, frame tickets record a view, and `HomeConfig` takes `submission` and `ports`.

- [#10](https://github.com/mostra-dev/mostra/pull/10) [`c7db95c`](https://github.com/mostra-dev/mostra/commit/c7db95c93ebdfbdabc71e75532e3b0189f234e0b) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Publish artifacts: `artifact/create`, `artifact/publish`, `artifact/list` and `artifact/get`. A
  builder child (Vite 8, React 19.3, MDX 3, Tailwind 4) turns a single `.tsx`, `.jsx` or `.mdx` file,
  or a directory with pages, components, `"use server"` modules, live sources, data and assets, into
  an immutable, content-addressed version, with no `package.json`; the source is snapshotted into the
  home, publishing is atomic, and the supervisor never loads artifact code. Every child process now
  starts behind a gate that opens once it is recorded, so a supervisor crash never leaves an
  unrecorded child running.

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`e6e80f8`](https://github.com/mostra-dev/mostra/commit/e6e80f889914757b51472ffc7e26c7fc59050403) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Server code's packages run from their own directories (D135): the server build keeps package imports external, and the worker resolves them from the layout the version was built against, so native addons load and packages find the files beside them. A removed layout is installed again from the store before a worker starts, and a version whose warm packages the runtime no longer holds runs against the ones it locked.

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`8fbec16`](https://github.com/mostra-dev/mostra/commit/8fbec16f1d66da8ced05724d8c2bb99151492ed9) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Run artifact server code (WP-08): one worker per active version with server code, started on
  first need through the `WorkerLauncher` seam, with plain calls, durable action runs (keys,
  re-attach, cancel, `interrupted` after a crash, logs capped at 1 MB), secrets from the home's
  owner-only store or a host's `secrets` port, signals, host events and state from server code,
  live sources and `live/push`, `secret/*` methods, workers and the idle exit in `instance/status`,
  the daemon's 30-minute idle exit and `--always-on`, and `mostra-runtime service
  install|uninstall|status` for the home's login service.

- [#27](https://github.com/mostra-dev/mostra/pull/27) [`7e283c2`](https://github.com/mostra-dev/mostra/commit/7e283c229947cd0904ab95803dc48cc52570ac43) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `verify` and publish's gate (WP-09, D138). `artifact/verify` builds and type-checks an artifact's source, renders it headlessly in a sandbox (a scratch ledger with the real interaction, actions, live and gateway code, so nothing of the home is touched), runs a smoke test that calls only server functions checking `dryRun()`, lints field IDs, compares the page with the last passing version (contracts, ARIA and pixels), and returns one `VerifyVerdict` with stable codes, screenshots at DPR 1 with token estimates for Claude, GPT and Gemini, ARIA snapshots and timings; `artifact/progress` reports its stages. `artifact/publish` reuses the verdict cached for the source and environment digests or runs verify, promotes verify's build, refuses on errors with `MOSTRA_PUBLISH_VERIFY_FAILED`, and with `force` records the error codes; a source that didn't build is never published. Versions record `verify: { status, verifyRevision }` (migration 8). New diagnostic areas and codes: `VERIFY`, `TYPE`, `FIELD`, `RUNTIME`, `CONSOLE`, `NETWORK`, `A11Y`, `SMOKE`, `REGRESSION`, `MOSTRA_PUBLISH_VERIFY_FAILED`, `MOSTRA_ENV_BROWSER_MISSING`. The client runtime installs a field probe for the `verify` target, and the shell shows only the frame for it. `@mostra/verify` is the new runner package. The warm set gains `@types/react`, `@types/react-dom` and `@types/node` for the type check.

### Patch Changes

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`5b8ab1f`](https://github.com/mostra-dev/mostra/commit/5b8ab1fb31825286bd48a9767e17927f746c7f82) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A link sees only the runs of functions it may run, before anything is attached for it; a run's
  progress and a live source's errors are redacted like its other output; a call during a worker's
  idle stop waits for it instead of starting workers the version can't hold; a publish that clears a
  park starts the artifact's live producers again, also when it reuses the version.

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`6bf1423`](https://github.com/mostra-dev/mostra/commit/6bf1423d3201ca9feb362aa1c49a265181573b9f) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A daemon whose home has a login service installed never exits for lack of work, whoever started
  it; the systemd unit escapes newlines and `%` in paths.

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`224beed`](https://github.com/mostra-dev/mostra/commit/224beed8f2b431c45e09be932e03769e5d25594b) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A worker the watchdog stops while its heap is near the limit is reported as out of memory, not as
  hung: near the limit, garbage collection stalls the event loop before the heap gives out.

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`6427fc2`](https://github.com/mostra-dev/mostra/commit/6427fc28e055460ecf556bffd5541b7a46d13c8b) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A run without a key is its viewer's own: other viewers can't attach, cancel or follow it, and a
  client key never joins another viewer's run. Keyed runs stay shared by every viewer that may run
  the function.

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`aff6c50`](https://github.com/mostra-dev/mostra/commit/aff6c50f54f81a64ecf2eab04c5de7fba47e944e) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A secret written into the home's store by hand while the instance runs is redacted like any other
  once server code reads it.

- [#37](https://github.com/mostra-dev/mostra/pull/37) [`47500cc`](https://github.com/mostra-dev/mostra/commit/47500cc59597a00a16787fb8e23b1f8f78b1767c) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `verify` no longer fails an artifact that imports an npm package without type declarations: TypeScript's TS7016 alone made the type check exit 1, which verify read as a check that never ran (`MOSTRA_TYPE_ERROR`) beside the intended `MOSTRA_TYPE_UNTYPED_PACKAGE` warning (D138 item 8). Any error TypeScript printed now explains its exit, whatever severity Mostra gives it.

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`ec6a96d`](https://github.com/mostra-dev/mostra/commit/ec6a96d65291e6994fdf786b56bd62cba5418a8a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A worker is stopped for silence only after three unanswered watchdog pings in a row, so a ping
  queued behind a large result never stops a worker; plain calls stop at 16 MiB of result like runs,
  a reader that goes away cancels its call, and a cancel ends a run at once while its worker starts.
- Updated dependencies [[`c37abca`](https://github.com/mostra-dev/mostra/commit/c37abca1b7d39e72781aac0b01e3a81ef20de0e6), [`f86a1d3`](https://github.com/mostra-dev/mostra/commit/f86a1d33ee3dcff3e32578876d41c423338dbdde), [`db2d46c`](https://github.com/mostra-dev/mostra/commit/db2d46c8d27077de225e73543007c69cf7598ff7), [`2fa9414`](https://github.com/mostra-dev/mostra/commit/2fa94140fa30d0a036efe04e1b750d8db6b82721), [`ea68d0a`](https://github.com/mostra-dev/mostra/commit/ea68d0abc2fa93e372865b0f504a1c4d79c21c57), [`c148a7b`](https://github.com/mostra-dev/mostra/commit/c148a7bd9f3175ef6f44e989354d6583e5e41009), [`f1f7bd0`](https://github.com/mostra-dev/mostra/commit/f1f7bd0c38fc3a7567f6e3a2714fcd064bf4408a), [`a0ba1b6`](https://github.com/mostra-dev/mostra/commit/a0ba1b6349cf537a6086c16dafdbc8305dedeb94), [`67f353c`](https://github.com/mostra-dev/mostra/commit/67f353cd7c13af4ae265279ba91053f77428b7b7), [`dd5648f`](https://github.com/mostra-dev/mostra/commit/dd5648ff254e153b4eac5e8cab61979f725730db), [`ec6a96d`](https://github.com/mostra-dev/mostra/commit/ec6a96d65291e6994fdf786b56bd62cba5418a8a), [`59aaab3`](https://github.com/mostra-dev/mostra/commit/59aaab33455cc9bf8e91bca24d97c1b84123212e), [`66af0b5`](https://github.com/mostra-dev/mostra/commit/66af0b5b54d76c8d0c7c898033a9919ae010d571), [`8bce8c7`](https://github.com/mostra-dev/mostra/commit/8bce8c78f5f0b6b10f9928d8de261961e5b7dc0a), [`7e283c2`](https://github.com/mostra-dev/mostra/commit/7e283c229947cd0904ab95803dc48cc52570ac43)]:
  - @mostra/protocol@0.1.0
