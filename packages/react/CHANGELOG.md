# @mostra/react

## 0.11.0

### Minor Changes

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`312f1c2`](https://github.com/mostra-dev/mostra/commit/312f1c22811cbf53075a215ca71de9cbfcefd6f1) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Pausing, and the remote server's operator boundary (WP-30, RM-09, HO-09):
  
  - `mostra pause <artifact> [--reason <text>]` and `mostra resume <artifact>` (`artifact/pause`): a paused artifact stays viewable and its links keep working, while submissions answer 423 `MOSTRA_SUBMIT_PAUSED` and actions 423 `MOSTRA_ACTION_PAUSED`, keeping the draft. On an owner instance the pause also goes to every server the artifact is hosted on; a pause the server's operator made is lifted only by the operator (`MOSTRA_REMOTE_PAUSED_BY_OPERATOR`).
  - `mostra-runtime server` loads an operator module (`operator` in its configuration) and calls its ports with their time limits and no-op defaults: `limits` (shares, pushes and links fail closed with `MOSTRA_REMOTE_OPERATOR_UNAVAILABLE` when it doesn't answer, while views and answers proceed), `metering` and `events` (at least once, with stable IDs, across restarts), `abuse` (the shell's report control and the after-push hook), `policy` (interstitial, footer, after-submit line, link lifetimes), `routing` (hosts and link hosts an operator supplies, recorded for one home forever) and the server handle (quarantine, pause, suspension, link revocation, moving and restoring homes, removal), each acting on one hosted route or home only.
  - Hosted links minted without a viewer act as one anonymous viewer per browser; per-IP and per-link submission rates (`rateLimits`) answer 429 `MOSTRA_REMOTE_RATE_LIMITED` with `Retry-After`; `X-Forwarded-For` is believed only from `trustedProxies`, read from the right, and IPv6 counts per /64.
  - `FrameTicket` gains `paused` and `hosted` (the trusted chrome's facts), `Viewer` and `useViewer()` gain `verified`, and nine diagnostics join the catalog.

### Patch Changes

- Updated dependencies [[`9964a88`](https://github.com/mostra-dev/mostra/commit/9964a881a2a7d57738bbc0691711982f13f0aea1), [`fad4595`](https://github.com/mostra-dev/mostra/commit/fad459525cf1ee74c6fc47960c733f34bc3a81ea), [`91bb507`](https://github.com/mostra-dev/mostra/commit/91bb5079056db241ae5b2fd7cbc743a590c616be), [`312f1c2`](https://github.com/mostra-dev/mostra/commit/312f1c22811cbf53075a215ca71de9cbfcefd6f1), [`2b95dad`](https://github.com/mostra-dev/mostra/commit/2b95dadd20892c3458598b9b1c161dd7237cb5f6)]:
  - @mostra/protocol@0.11.0

## 0.10.0

### Minor Changes

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`e0d2ab8`](https://github.com/mostra-dev/mostra/commit/e0d2ab8d68d8e3537d50e8a55375e51f0d44e064) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `useLive` reports `ownerOffline: true` on a hosted page while the page's owner is offline, so its producer can't refresh the value: `data` stays the last value, from `at`. The Skill's sharing reference covers the `hosted` manifest key and what `waiting` and `unknown` runs mean.
  
  A publish made after the owner's link had nothing left to push now reaches its servers: the push queue's drain no longer stays registered once it ended before its first await. A share to two servers hosts the artifact on both, and their answers reach the owner with their own origin.

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`93c04c1`](https://github.com/mostra-dev/mostra/commit/93c04c1890ebeb56d6abc7bcd2d5f2d139ae3ee5) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - An instance signs in to a remote server by the device grant (`remote/login`, `remote/login.wait`, `remote/logout`, `remote/status`), keeps its refresh token in the home, dials the server's binding and keeps it. Submissions its hosted home delivers are stored with their IDs, digest and snapshot and reach this instance's own hosts through its outbox; events of the artifacts it owns are copied once each, with `origin`. `useViewer().source` and `ViewerKind` gain `account` and `anonymous`, `EventRecord` and `Results.submission` gain `origin`, and a delivery envelope may carry the stored `snapshot` and its `cursor`.

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`e023f3f`](https://github.com/mostra-dev/mostra/commit/e023f3f651765a201400b4b5b09ef35963619100) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The relay: a hosted page's action runs and plain calls run on the artifact's owner instance, with its own secrets, over its binding (`port/relay.run`, `cancel`, `reconcile`, `call`; `relay/run.update`, `relay/call.batch`). While the owner is offline a run waits (`RunStatus` gains `waiting` in use and `unknown`), as the manifest's `hosted.offline` says: `queue` (up to its limit, then `failed` with reason `owner-offline`) or `fail` (at once), in a queue capped per artifact (`MOSTRA_REMOTE_QUEUE_FULL`) that drains in order at a bounded rate when the owner returns. A run the owner never reported within the limit is `unknown`, and its reported end replaces it once; after every reconnect the owner's accepted runs are reconciled before anything drains, and an owner restored to before runs it accepted makes them `unknown`. `RunState.ownerUnreachable` marks a running run whose owner is out of reach. By default only a signed-in viewer or a link minted for a named person may trigger a relayed action (`hosted.actions`, `MOSTRA_REMOTE_SIGN_IN_REQUIRED`). Hosted pages read their tallies. In `@mostra/react`, `run()` rejects for an `unknown` run, which keeps following for its owner's report.
  
  Server code's signals, host events and shared state in a relayed run act on the hosted home (`relay/effect`; `state/patch`'s `causation`), and so do the owner's own `state/*` and `live/push` of a hosted artifact. A hosted page's live sources run on its owner while someone views (`port/relay.live`, `relay/live.value`), redacted before they leave; `LiveState.ownerOffline` marks a value its producer can't refresh while the owner is away.
  
  A server's `rateLimits.perLink.relayedRuns` limits each link's relayed actions: past it a page gets 429 `MOSTRA_REMOTE_RATE_LIMITED` with `Retry-After`, before anything is recorded or relayed.
  
  A relayed run its owner refuses before recording it ends `failed` with reason `owner-refused`; one the connected owner never answered is sent again, which joins the owner's record if it has one.
  
  After its review: a hosted push's listing paths are checked for every system the server runs on; a binding with ports must name its own instance link; the newest session of a link is its own, and a failed reconcile is tried again; a run never ends without the output the relay lost; an expired waiting run is never sent; an `unknown` run is reconciled until the owner's end replaces it; a cancel pressed during an acknowledgement reaches the owner; followed pages and lost submissions survive a reconnect; a restore is told once; a refused push no longer blocks later ones; live values reach every server hosting an artifact.

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`b9e6780`](https://github.com/mostra-dev/mostra/commit/b9e67808da7d67cba596d9f1019ed83aa69acfb0) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Counts by choice: a manifest's `tally` names a fixed-choice field, and Mostra counts each accepted submission's choice in the submit transaction and pushes the counts to viewers under `useLive("$tally/<field>")`, with no server code. A value outside the listed choices counts nothing, and below `minTotal` viewers see only the total. The manifest also takes `hosted`, the settings a remote server reads. A page that long-polls (behind a quick tunnel) now hears of an action's end at once, instead of up to 20 seconds later, because the shell's own poll of the same view no longer takes the page's run updates ([#119](https://github.com/mostra-dev/mostra/issues/119)).

### Patch Changes

- Updated dependencies [[`f0b3cdc`](https://github.com/mostra-dev/mostra/commit/f0b3cdc5156956282d628942419b8d500673c4f6), [`6dbd51b`](https://github.com/mostra-dev/mostra/commit/6dbd51be267212240fd33a4b109ffeb62c503375), [`93c04c1`](https://github.com/mostra-dev/mostra/commit/93c04c1890ebeb56d6abc7bcd2d5f2d139ae3ee5), [`eec2d62`](https://github.com/mostra-dev/mostra/commit/eec2d6251a6e4b3300745cc2565668e51642d9c3), [`e023f3f`](https://github.com/mostra-dev/mostra/commit/e023f3f651765a201400b4b5b09ef35963619100), [`bb061a2`](https://github.com/mostra-dev/mostra/commit/bb061a2a17239d93bfedb13cba3654503da04f4c), [`09ebb64`](https://github.com/mostra-dev/mostra/commit/09ebb643f70362a4170e6e7b03b2ac5848b11d7b), [`622ac47`](https://github.com/mostra-dev/mostra/commit/622ac475f0a58e7508925724ed7e51f4b90fe50c), [`b9e6780`](https://github.com/mostra-dev/mostra/commit/b9e67808da7d67cba596d9f1019ed83aa69acfb0)]:
  - @mostra/protocol@0.10.0

## 0.9.0

### Patch Changes

- [#112](https://github.com/mostra-dev/mostra/pull/112) [`c7ea80c`](https://github.com/mostra-dev/mostra/commit/c7ea80cd60ee03aef1fbd17c6d38003b287d153b) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The READMEs say what the package carries today: fields, submissions, actions and live data in `@mostra/react`; the version banner and trusted controls in `@mostra/shell`.
- Updated dependencies [[`1c414a8`](https://github.com/mostra-dev/mostra/commit/1c414a854fc8c205e24c7220d6da97945b7b820a), [`9b2acf9`](https://github.com/mostra-dev/mostra/commit/9b2acf916a9fd762a62b6c087f560c541e742755)]:
  - @mostra/protocol@0.9.0

## 0.8.0

### Patch Changes

- [#108](https://github.com/mostra-dev/mostra/pull/108) [`895e62a`](https://github.com/mostra-dev/mostra/commit/895e62aa1a6bcd275173ab2285953a3e56a377e7) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `useLive` stays `isLoading` until a source's first value or error arrives, when the artifact's producer is loading it. A source whose producer hadn't produced yet was reported loaded with no data, so a page could render (or crash on) a missing value, and `verify` judged and screenshotted the page before its data arrived. The gateway says which sources a first load is on its way for (`LiveState.awaiting`, additive), so a key only `mostra push` writes, or a source that only streams, is never waited for.
- Updated dependencies [[`895e62a`](https://github.com/mostra-dev/mostra/commit/895e62aa1a6bcd275173ab2285953a3e56a377e7)]:
  - @mostra/protocol@0.8.0

## 0.7.0

### Minor Changes

- [#100](https://github.com/mostra-dev/mostra/pull/100) [`7b65b43`](https://github.com/mostra-dev/mostra/commit/7b65b43fefc04527229abcb77fb04385a4a2b02a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Sharing (D158). `mostra share <artifact> --tailnet` opens an artifact to the people of your tailnet through Tailscale Serve, each known by their tailnet identity; `mostra share <artifact> --public` opens it to anyone holding the link through a Cloudflare quick tunnel (or Tailscale Funnel with `--via funnel`), for 1 hour by default and 7 days at most. `mostra share stop` and `mostra share list` end and list shares; the host protocol has `share/start`, `share/stop` and `share/list`, and `instance/status` reports active shares, which keep a daemon running. Each tunnel address is a gateway face of its own on loopback, so a request is judged by the socket it came through, never by its `Host`. Frames on another site than their shell (a Cloudflare share, a host's external bases) enter in worker mode: a bootstrap page, Mostra's service worker, and single-use tickets for event streams, long polls and WebSockets; where a tunnel holds streams back, pages long-poll. Hosts get the `addressing` port (`port/addressing.externalBase`, HO-10) in the SDK, the Rust crate and the conformance kit, whose new `ports.addressing` scenario, and the shares in `ports.identity`, run through local stand-ins for `tailscale` and `cloudflared`.

### Patch Changes

- Updated dependencies [[`7b65b43`](https://github.com/mostra-dev/mostra/commit/7b65b43fefc04527229abcb77fb04385a4a2b02a)]:
  - @mostra/protocol@0.7.0

## 0.6.2

### Patch Changes

- Updated dependencies [[`e33361f`](https://github.com/mostra-dev/mostra/commit/e33361ff9c886b81daf1dada40ff481444f92cb0)]:
  - @mostra/protocol@0.6.2

## 0.6.1

### Patch Changes

- [#90](https://github.com/mostra-dev/mostra/pull/90) [`753f3de`](https://github.com/mostra-dev/mostra/commit/753f3deed9bef96c96b671c4973fd799bedb2b81) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Dependency updates, each past its 7-day release age: React 19.3.1, React Router 8.5.0, Vite 8.3.4, Zod 4.6.7, `@hono/node-server` 2.1.5, undici 8.12.3, Playwright 1.64.1 (the same browsers as 1.64.0), and in the warm set Base UI 1.9.0, Radix 1.8.1, Motion 14.4.0, TanStack Table 9.3.1 and the other minor and patch releases of its libraries; the installer's pnpm 10.34.7.
- Updated dependencies [[`753f3de`](https://github.com/mostra-dev/mostra/commit/753f3deed9bef96c96b671c4973fd799bedb2b81)]:
  - @mostra/protocol@0.6.1

## 0.6.0

### Patch Changes

- Updated dependencies [[`dace950`](https://github.com/mostra-dev/mostra/commit/dace950c6ca7004ea7e11f1b07c23e9abea8de18), [`ee5a888`](https://github.com/mostra-dev/mostra/commit/ee5a8883ec3cfd8c0f3d849f2b5a78b761e39c4a)]:
  - @mostra/protocol@0.6.0

## 0.5.0

### Patch Changes

- Updated dependencies [[`7893700`](https://github.com/mostra-dev/mostra/commit/78937009ac67a4780b3c29017b5e84dd818d6f75), [`c3c0052`](https://github.com/mostra-dev/mostra/commit/c3c0052183bcc02b27d755001419d1e55a3a8e7f), [`e48e7aa`](https://github.com/mostra-dev/mostra/commit/e48e7aad93787e3f2a8e41c6088239bcc2f11178)]:
  - @mostra/protocol@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`fe84a16`](https://github.com/mostra-dev/mostra/commit/fe84a160c095c6dfe29f3ed5c956ae36407c788f)]:
  - @mostra/protocol@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`bb00a14`](https://github.com/mostra-dev/mostra/commit/bb00a1474c4737e800d5c38824c3250fe3b43890)]:
  - @mostra/protocol@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`0ff9ae5`](https://github.com/mostra-dev/mostra/commit/0ff9ae5b682ab9b9d5db42b9984d553ce025428b)]:
  - @mostra/protocol@0.2.0

## 0.1.0

### Minor Changes

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`c37abca`](https://github.com/mostra-dev/mostra/commit/c37abca1b7d39e72781aac0b01e3a81ef20de0e6) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Fixes from WP-08's Claude Opus review (D136). Arguments a page sends can't be registered symbols, async iterables, bigints of more than 10,000 digits or promises that never settle, and are checked before a run is recorded or a worker starts (`checkArgumentFrames`); a typed-array subclass such as `Buffer` crosses as its built-in base. A run whose action returned despite a cancel ends `succeeded` with its result. A page sees only its own viewer's signals from server code, no `host.*` event, `action.*` events only for runs it may see, and `worker.crashed` without its cause. An unknown function answers 404 before anything is recorded. A worker that dies during its start counts as one crash. Results and live values are redacted as values, bytes included; multi-line secrets line by line. A client key joins only a run of its own function. Live producers reconcile without scanning every artifact. Slow readers get coalesced run and live updates, pages render at most once per frame, and `runs/attach` takes `held` so a renewal reads only what is newer (`RunState.logFrom`, `batchFrom`). Migration 7 refuses replacing a run and changing its result batches.

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`59aaab3`](https://github.com/mostra-dev/mostra/commit/59aaab33455cc9bf8e91bca24d97c1b84123212e) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add `useAction` and `useLive` (WP-08): durable action runs with keys, joining, re-attach after a
  reload, progress, log, partial results and cancel; live sources with latest and append modes, and
  `LiveSources` typed from `live.ts`. Server references now call the server (`setServerCallback`);
  the client runtime's entries carry `"use client"`.

- [#20](https://github.com/mostra-dev/mostra/pull/20) [`df3b959`](https://github.com/mostra-dev/mostra/commit/df3b95986eebb913dc4e9a51a87d4fd90db7488e) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add the client runtime (INTERFACES §2.3): `useField`, `useSubmit`, `useSubmitControl`,
  `useSignal`, `useChoice`, `useViewer` and `useArtifact`, with optimistic saves debounced and
  flushed on blur, `visibilitychange`, `pagehide` and before a submit, an IndexedDB journal that a
  closed tab or an offline page replays in order, per-field conflicts with "keep mine" and "take
  theirs", and convergence across tabs; a Claude-compatible `window.storage` backed by fields;
  `@mostra/react/form`, react-hook-form on Mostra fields; `@mostra/react/router`, which mounts
  `pages/` artifacts with the history their delivery target needs; `mountArtifact`; and
  `MostraError`, whose `code` is the diagnostic code.

- [#10](https://github.com/mostra-dev/mostra/pull/10) [`482b66d`](https://github.com/mostra-dev/mostra/commit/482b66d618a0dcadd0c57124833ddf26032a95ff) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - First release of `@mostra/react`: `defineArtifact`, the typed manifest helper artifacts declare in
  their entry, and `createServerReference`, the client stub Mostra's builder compiles `"use server"`
  exports into.

- [#14](https://github.com/mostra-dev/mostra/pull/14) [`0c51c9d`](https://github.com/mostra-dev/mostra/commit/0c51c9dea894d1dd3772d972c8125a0dad4e7af8) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add the artifact end of the shell bridge (SH-04): `connectShell`, `reportReady` and `openLink`,
  which sends the viewer to a URL in a new tab through the shell. Every
  version's generated entry starts it, so a page inside Mostra's shell introduces itself with MCP
  Apps' `ui/initialize` and reports `mostra/ready`, accepting messages only from its shell's exact
  origin.

- [#27](https://github.com/mostra-dev/mostra/pull/27) [`7e283c2`](https://github.com/mostra-dev/mostra/commit/7e283c229947cd0904ab95803dc48cc52570ac43) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `verify` and publish's gate (WP-09, D138). `artifact/verify` builds and type-checks an artifact's source, renders it headlessly in a sandbox (a scratch ledger with the real interaction, actions, live and gateway code, so nothing of the home is touched), runs a smoke test that calls only server functions checking `dryRun()`, lints field IDs, compares the page with the last passing version (contracts, ARIA and pixels), and returns one `VerifyVerdict` with stable codes, screenshots at DPR 1 with token estimates for Claude, GPT and Gemini, ARIA snapshots and timings; `artifact/progress` reports its stages. `artifact/publish` reuses the verdict cached for the source and environment digests or runs verify, promotes verify's build, refuses on errors with `MOSTRA_PUBLISH_VERIFY_FAILED`, and with `force` records the error codes; a source that didn't build is never published. Versions record `verify: { status, verifyRevision }` (migration 8). New diagnostic areas and codes: `VERIFY`, `TYPE`, `FIELD`, `RUNTIME`, `CONSOLE`, `NETWORK`, `A11Y`, `SMOKE`, `REGRESSION`, `MOSTRA_PUBLISH_VERIFY_FAILED`, `MOSTRA_ENV_BROWSER_MISSING`. The client runtime installs a field probe for the `verify` target, and the shell shows only the frame for it. `@mostra/verify` is the new runner package. The warm set gains `@types/react`, `@types/react-dom` and `@types/node` for the type check.

### Patch Changes

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`5b8ab1f`](https://github.com/mostra-dev/mostra/commit/5b8ab1fb31825286bd48a9767e17927f746c7f82) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `useAction` shows the run of its current function and key: a component that changes its key no
  longer shows, cancels or joins the old key's run. `useLive` applies reads and updates of a source
  in the order they arrived, and a late read never takes newer points out of an append window.
- Updated dependencies [[`c37abca`](https://github.com/mostra-dev/mostra/commit/c37abca1b7d39e72781aac0b01e3a81ef20de0e6), [`f86a1d3`](https://github.com/mostra-dev/mostra/commit/f86a1d33ee3dcff3e32578876d41c423338dbdde), [`db2d46c`](https://github.com/mostra-dev/mostra/commit/db2d46c8d27077de225e73543007c69cf7598ff7), [`2fa9414`](https://github.com/mostra-dev/mostra/commit/2fa94140fa30d0a036efe04e1b750d8db6b82721), [`ea68d0a`](https://github.com/mostra-dev/mostra/commit/ea68d0abc2fa93e372865b0f504a1c4d79c21c57), [`c148a7b`](https://github.com/mostra-dev/mostra/commit/c148a7bd9f3175ef6f44e989354d6583e5e41009), [`f1f7bd0`](https://github.com/mostra-dev/mostra/commit/f1f7bd0c38fc3a7567f6e3a2714fcd064bf4408a), [`a0ba1b6`](https://github.com/mostra-dev/mostra/commit/a0ba1b6349cf537a6086c16dafdbc8305dedeb94), [`67f353c`](https://github.com/mostra-dev/mostra/commit/67f353cd7c13af4ae265279ba91053f77428b7b7), [`dd5648f`](https://github.com/mostra-dev/mostra/commit/dd5648ff254e153b4eac5e8cab61979f725730db), [`ec6a96d`](https://github.com/mostra-dev/mostra/commit/ec6a96d65291e6994fdf786b56bd62cba5418a8a), [`59aaab3`](https://github.com/mostra-dev/mostra/commit/59aaab33455cc9bf8e91bca24d97c1b84123212e), [`66af0b5`](https://github.com/mostra-dev/mostra/commit/66af0b5b54d76c8d0c7c898033a9919ae010d571), [`8bce8c7`](https://github.com/mostra-dev/mostra/commit/8bce8c78f5f0b6b10f9928d8de261961e5b7dc0a), [`7e283c2`](https://github.com/mostra-dev/mostra/commit/7e283c229947cd0904ab95803dc48cc52570ac43)]:
  - @mostra/protocol@0.1.0
