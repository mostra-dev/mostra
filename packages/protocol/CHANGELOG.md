# @mostra/protocol

## 0.4.0

### Patch Changes

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`fe84a16`](https://github.com/mostra-dev/mostra/commit/fe84a160c095c6dfe29f3ed5c956ae36407c788f) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `MOSTRA_ENV_SERVICE_FAILED` and `MOSTRA_HOME_NOT_ALWAYS_ON` name Task Scheduler, the login service on Windows, beside launchd and systemd.

## 0.3.0

### Minor Changes

- [#54](https://github.com/mostra-dev/mostra/pull/54) [`bb00a14`](https://github.com/mostra-dev/mostra/commit/bb00a1474c4737e800d5c38824c3250fe3b43890) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Adds `MOSTRA_ENV_HELPER_MISSING`: on Windows the runtime needs its helper, `mostra-win.exe`, and reports this code when it can find none. A source path, an artifact path and `artifact/create`'s directory may also be a Windows absolute path (`C:\…`, `C:/…` or `\\server\share\…`), beside the POSIX `/…`; a drive-relative or root-relative path is still refused.

## 0.2.0

### Minor Changes

- [#44](https://github.com/mostra-dev/mostra/pull/44) [`0ff9ae5`](https://github.com/mostra-dev/mostra/commit/0ff9ae5b682ab9b9d5db42b9984d553ce025428b) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add the `identity` port (`port/identity.resolve`, D143): a host names the person behind a link opened without a viewer, or answers `null` for Mostra's own default. `MOSTRA_HOST_IDENTITY_UNAVAILABLE` is new. The published JSON Schema bundles now list every method and notification (`x-mostra-methods`, `x-mostra-notifications`), which `hostNotifications` exports too.

## 0.1.0

### Minor Changes

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`c37abca`](https://github.com/mostra-dev/mostra/commit/c37abca1b7d39e72781aac0b01e3a81ef20de0e6) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Fixes from WP-08's Claude Opus review (D136). Arguments a page sends can't be registered symbols, async iterables, bigints of more than 10,000 digits or promises that never settle, and are checked before a run is recorded or a worker starts (`checkArgumentFrames`); a typed-array subclass such as `Buffer` crosses as its built-in base. A run whose action returned despite a cancel ends `succeeded` with its result. A page sees only its own viewer's signals from server code, no `host.*` event, `action.*` events only for runs it may see, and `worker.crashed` without its cause. An unknown function answers 404 before anything is recorded. A worker that dies during its start counts as one crash. Results and live values are redacted as values, bytes included; multi-line secrets line by line. A client key joins only a run of its own function. Live producers reconcile without scanning every artifact. Slow readers get coalesced run and live updates, pages render at most once per frame, and `runs/attach` takes `held` so a renewal reads only what is newer (`RunState.logFrom`, `batchFrom`). Migration 7 refuses replacing a run and changing its result batches.

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`f86a1d3`](https://github.com/mostra-dev/mostra/commit/f86a1d33ee3dcff3e32578876d41c423338dbdde) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add the shapes of actions, live data and secrets: run states and their ephemeral deltas, live
  states and updates, the browser protocol's `call`, `runs`, `runs/attach`, `runs/{id}/cancel` and
  `live` payloads, the worker channel, `secret/set`, `secret/list`, `secret/delete`, `live/push` and
  `port/secrets.get`, `instance/status`'s `workers` and `idleExitAt`, `PollResult.ephemeral`, and the
  ACTION, RUNTIME, SECRET, LIVE and ENV codes they report.

- [#10](https://github.com/mostra-dev/mostra/pull/10) [`db2d46c`](https://github.com/mostra-dev/mostra/commit/db2d46c8d27077de225e73543007c69cf7598ff7) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add the artifact manifest (`ArtifactManifest`, `SubmissionPolicy`, `ArtifactLink`), the authoring
  methods `artifact/create`, `artifact/publish`, `artifact/list` and `artifact/get` with
  `SourceRef`, `ArtifactRef`, `ArtifactSummary`, `ArtifactDetail`, `VersionSummary` and
  `PublishReceipt` (whose `url` is optional until the gateway serves views), the `ARTIFACT`
  diagnostic area, and the MANIFEST, BUILD, ACTION, PUBLISH, ARTIFACT, TARGET and ENV codes builds
  and publishes report.

- [#37](https://github.com/mostra-dev/mostra/pull/37) [`2fa9414`](https://github.com/mostra-dev/mostra/commit/2fa94140fa30d0a036efe04e1b750d8db6b82721) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The runtime bundle's contract (RT-01, D142): `BundleInfo` (`bundle.json`), `BundleFiles` (`files.json`), `BundleBrowser`, `BundleAsset`, `BundlePins` (`bundles.json`) and `BundleSetup` (`.mostra-setup.json`) as Zod schemas with JSON Schema, `BUNDLE_PLATFORMS`, `BUNDLE_NAME`, `BUNDLE_SETUP_MARKER` and `bundleAssetName`, and four diagnostics: `MOSTRA_ENV_BUNDLE_INVALID`, `MOSTRA_ENV_BUNDLE_DOWNLOAD_FAILED`, `MOSTRA_ENV_BUNDLE_UNAVAILABLE` and `MOSTRA_ENV_NODE_UNSUPPORTED`. `MOSTRA_ENV_BROWSER_MISSING`'s hint now names the bundle's setup.

- [#29](https://github.com/mostra-dev/mostra/pull/29) [`ea68d0a`](https://github.com/mostra-dev/mostra/commit/ea68d0abc2fa93e372865b0f504a1c4d79c21c57) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add the methods the CLI needs (D140): `view/default` and `view/launch` (a one-time launch URL for
  a browser), `gc/run` with its result shape, `instance/check`, and `dev/start`, `dev/stop` and the
  `dev/notify` notification; `VersionSummary.collected`; `GcRunResult.warnings` for a step gc
  couldn't finish; the `CLI` diagnostic area with `MOSTRA_CLI_USAGE`, `MOSTRA_CLI_UNKNOWN_COMMAND` and
  `MOSTRA_CLI_CONFIG_UNWRITABLE`; and `MOSTRA_ARTIFACT_VERSION_COLLECTED`,
  `MOSTRA_ENV_RUNTIME_MISSING`, `MOSTRA_HOME_NOT_ALWAYS_ON` and `MOSTRA_HOME_GC_INCOMPLETE`.

- [#20](https://github.com/mostra-dev/mostra/pull/20) [`c148a7b`](https://github.com/mostra-dev/mostra/commit/c148a7bd9f3175ef6f44e989354d6583e5e41009) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add what the client runtime and the shell's trusted controls speak (WP-07): the browser
  protocol's view context (`ViewContext`, `FrameTicket`, `VersionRef`, `DeliveryTarget`) and the
  shell's own routes (`ShellSubmitRequest`, `ChooseRequest`, `FollowRequest`, `CarryOver`,
  `OrphanedField`); the bridge messages `mostra/fields`, `mostra/page`, `mostra/controls.request`,
  `mostra/flush`, `mostra/version.available` and `mostra/field.focus`, with `ui/initialize`'s result
  carrying the view as `mostra` (`ViewContextWire`, open to values later releases add, read by
  `readViewContext`); the `trustedControls` port methods
  `port/trustedControls.policy` and `port/trustedControls.activated` with `ControlsPolicy`,
  `SubmitChannel` and `TrustedControl`; `HomeConfig.submitChannels` (D108); each delivery's
  `waiting` flag, the submit answer's `deliveries` and the stream snapshot's `latest` version; the bridge's limits `BRIDGE_TEXT_MAX` and
  `BRIDGE_FIELDS_MAX`; and the codes `MOSTRA_SUBMIT_CHANNEL_DENIED`, `MOSTRA_SUBMIT_BLOCKED` and
  `MOSTRA_FIELD_CONFLICT`.

- [#12](https://github.com/mostra-dev/mostra/pull/12) [`f1f7bd0`](https://github.com/mostra-dev/mostra/commit/f1f7bd0c38fc3a7567f6e3a2714fcd064bf4408a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add the dependency surface (D43, D95): the host method `deps/add` with `AddedPackage`, which
  installs npm packages into the home's store and records them in an artifact's lockfile; the
  `dependencies` field of `HomeConfig` with `DependencyPolicy` (`auto` or `explicit`); and the DEP
  diagnostic codes `MOSTRA_DEP_MISSING`, `_NOT_FOUND`, `_OFFLINE`, `_TIMEOUT`, `_INSTALL_FAILED`,
  `_WARM_CONFLICT` and `_SPEC_INVALID`.

- [#1](https://github.com/mostra-dev/mostra/pull/1) [`a0ba1b6`](https://github.com/mostra-dev/mostra/commit/a0ba1b6349cf537a6086c16dafdbc8305dedeb94) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - First release of `@mostra/protocol`: branded ID kinds with parsers and generators for every
  prefix, event cursors, dated protocol revisions with `negotiateRevision`, the `Diagnostic` schema
  and the diagnostic catalog with `createDiagnostic`, and the published JSON Schema (2020-12 and
  draft-07).

- [#14](https://github.com/mostra-dev/mostra/pull/14) [`67f353c`](https://github.com/mostra-dev/mostra/commit/67f353cd7c13af4ae265279ba91053f77428b7b7) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add the viewing surface (D97): the host methods `view/url`, `view/rotate` and `view/revoke` with
  `CapabilityLink`; `CapabilityScope` (including `signal` and `action:*`), `Duration` and the scope helpers;
  `PublishReceipt.tokenId` beside its `url`; `GatewayStatus` in `instance/status`; the request checks every Mostra HTTP endpoint applies
  (`checkRequest` and its helpers, D96); the shell ↔ artifact bridge (`connectBridge` with the
  MCP Apps-shaped `ui/initialize`, `ui/notifications/initialized`, `ui/notifications/size-changed`
  `ui/open-link` with `OPEN_LINK_SCHEMES`, and `mostra/ready`); the HYGIENE diagnostic area; and
  `MOSTRA_ENV_PORT_TAKEN`, `MOSTRA_ENV_BIND_FAILED`, `MOSTRA_ENV_SHELL_MISSING`,
  `MOSTRA_ARTIFACT_VERSION_NOT_FOUND` and `MOSTRA_HOST_REQUEST_ID_REUSED`.

- [#16](https://github.com/mostra-dev/mostra/pull/16) [`dd5648f`](https://github.com/mostra-dev/mostra/commit/dd5648ff254e153b4eac5e8cab61979f725730db) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add the interaction ledger's surface (WP-06): the host methods `state/get`, `state/patch`,
  `results/get`, `wait`, `events/read`, `events/subscribe` (with the `events/notify`
  notification), `events/unsubscribe` and `events/ack`; the port methods
  `port/submissions.deliver` (`SubmissionEnvelope`) and `port/drafts.mirror` (`DraftMirror`); the
  wire types `Viewer`, `ViewerSpec`, `Actor`, `FieldOp`, `FieldState`, `FieldConflict`,
  `MutationResult`, `DocumentRevision`, `EventRecord`, `EventFilter`, `WaitCondition`,
  `SubmissionSummary`, `DeliveryStatus` and `Results`; `DeliveryId` (`dlv_`); `canonicalJson`
  (RFC 8785); browser-protocol revision `2026-10-15` with its request and stream payloads;
  `HomeConfig.submission` and `HomeConfig.ports`; `view/url`'s `viewer` and `CapabilityLink.viewer`;
  `instance/status`'s `deliveries`; and the SUBMIT and FIELD diagnostic areas with
  `MOSTRA_HOST_CURSOR_COMPACTED`, `MOSTRA_HOST_SUBSCRIPTION_UNKNOWN`,
  `MOSTRA_HOST_NOTIFICATION_UNSUPPORTED` and `MOSTRA_HOST_MESSAGE_TOO_LARGE`; `events/read`'s
  `acceptCompacted` and `compacted`, `events/notify`'s `compacted`, `Results.signalsOmitted` and
  `signalsCompacted`, and `MAX_LINE_LENGTH`.

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`59aaab3`](https://github.com/mostra-dev/mostra/commit/59aaab33455cc9bf8e91bca24d97c1b84123212e) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `LiveRequest` keys take an optional `refresh`, which asks a live source's producer to load again.

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`66af0b5`](https://github.com/mostra-dev/mostra/commit/66af0b5b54d76c8d0c7c898033a9919ae010d571) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add the server-function serializer (`ValueWriter`, `ValueReader`, `serializeAll`,
  `deserializeAll`): React's documented Server Function types plus async iterable results, written as
  JSON batches that stream promises and iterable items as they settle, with shared and cyclic objects
  kept, and `MOSTRA_ACTION_UNSERIALIZABLE` naming where a value outside the type set is.

- [#6](https://github.com/mostra-dev/mostra/pull/6) [`8bce8c7`](https://github.com/mostra-dev/mostra/commit/8bce8c78f5f0b6b10f9928d8de261961e5b7dc0a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Add the JSON-RPC 2.0 core every Mostra connection uses (`RpcPeer`, `RpcError`, `encodeLine`,
  `LineSplitter` and the message schemas; no batches in revision `2026-10-10`), the session methods
  `mostra/initialize`, `mostra/shutdown` and `instance/status` with their shapes (D84), and the HOME,
  HOST and PLATFORM diagnostic codes the instance reports. The build now keeps one module per source
  file, so bundlers drop what a consumer doesn't import.

- [#27](https://github.com/mostra-dev/mostra/pull/27) [`7e283c2`](https://github.com/mostra-dev/mostra/commit/7e283c229947cd0904ab95803dc48cc52570ac43) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `verify` and publish's gate (WP-09, D138). `artifact/verify` builds and type-checks an artifact's source, renders it headlessly in a sandbox (a scratch ledger with the real interaction, actions, live and gateway code, so nothing of the home is touched), runs a smoke test that calls only server functions checking `dryRun()`, lints field IDs, compares the page with the last passing version (contracts, ARIA and pixels), and returns one `VerifyVerdict` with stable codes, screenshots at DPR 1 with token estimates for Claude, GPT and Gemini, ARIA snapshots and timings; `artifact/progress` reports its stages. `artifact/publish` reuses the verdict cached for the source and environment digests or runs verify, promotes verify's build, refuses on errors with `MOSTRA_PUBLISH_VERIFY_FAILED`, and with `force` records the error codes; a source that didn't build is never published. Versions record `verify: { status, verifyRevision }` (migration 8). New diagnostic areas and codes: `VERIFY`, `TYPE`, `FIELD`, `RUNTIME`, `CONSOLE`, `NETWORK`, `A11Y`, `SMOKE`, `REGRESSION`, `MOSTRA_PUBLISH_VERIFY_FAILED`, `MOSTRA_ENV_BROWSER_MISSING`. The client runtime installs a field probe for the `verify` target, and the shell shows only the frame for it. `@mostra/verify` is the new runner package. The warm set gains `@types/react`, `@types/react-dom` and `@types/node` for the type check.

### Patch Changes

- [#24](https://github.com/mostra-dev/mostra/pull/24) [`ec6a96d`](https://github.com/mostra-dev/mostra/commit/ec6a96d65291e6994fdf786b56bd62cba5418a8a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `LineSplitter` searches only each new chunk for a newline, so a long message costs time in
  proportion to its length: a 32 MiB line in 64 KiB chunks took 1.6 s and now takes 20 ms.
