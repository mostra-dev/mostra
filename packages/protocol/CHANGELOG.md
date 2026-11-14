# @mostra/protocol

## 0.14.0

No changes in this release.

## 0.13.0

### Minor Changes

- [#144](https://github.com/mostra-dev/mostra/pull/144) [`dcafbe0`](https://github.com/mostra-dev/mostra/commit/dcafbe05617a99f0001356d5344cd234dd5acadc) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The remote server's operator ports do what INTERFACES §18.6 says, and give an operator more to go on (all additive within `OPERATOR_REVISION` `2026-11-08`):
  
  - `limits` is asked for a hosted page's relayed actions: `run` before a run is recorded, `run.wait` before it waits for an absent owner, `call` before a plain call is relayed. A refusal answers the operator's message (403 `MOSTRA_REMOTE_LIMIT_REACHED`, or 503 `MOSTRA_REMOTE_QUEUE_FULL` for `run.wait`) with nothing recorded or relayed and the link's relayed-action rate given back; a request that joins a recorded run, or a duplicate sent meanwhile, is never asked; no answer lets the action through; and a pause, a revoked link or a closed page during the wait refuses the action then.
  - A link's `idleExpiry` is judged from its last use before the visit that asks (its views and its other sessions' activity), so a fresh visit to an idle link answers 410 and a page open and in use keeps its link.
  - GitHub sign-ins carry `publicRepos`, `publicGists` and `followers` in `SignInIdentity.facts`; an `oidc` entry of `identityProviders` may name `claims` (at most 8, never `__proto__`, `constructor` or `prototype`) that go into `facts` under their names.
  - The sender line's verifier is recorded on each sign-in identity when its provider names the person, so renaming or retiring a configured provider changes no verified name (a label with control or format characters verifies nothing), and `IdentityProvider.verifies: { label }` lets a provider the operator module supplies verify names.
  - Metering adds `bytes.held`, the client bytes a home holds, sent when it changes (falling when content is removed, 0 once when nothing is left) and for every home once a day; a window's counters go out in batches of at most 1,000.
  - `LimitQuery.versionId` names the version on `version.push` and `storage`, the same in every round of one push.

## 0.12.0

### Minor Changes

- [#138](https://github.com/mostra-dev/mostra/pull/138) [`74888f3`](https://github.com/mostra-dev/mostra/commit/74888f3aaacac9fe215892c97754a4d2f234fe7c) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Teams (WP-31): expected respondents with personal links (`roster/add`, `roster/remove`, `roster/get`), the waits `submitted:all` and `submitted:<N>` with the durable `roster.completed` event, `results/list` for every submission, `useRespondents()` and `usePresence()` with opt-in cursor and selection sharing that is never stored, attribution of shared fields (who, by key, and when), and the manifest's `team.visibility` (`private` unless the artifact opts in). `mostra roster get|add|remove`, `mostra results --all`, `mostra share --cloud --respondent`, and `artifact_wait`'s team conditions. On a remote server, a hosted artifact's roster lives on its hosted home, `roster.completed` reaches the operator's events, and the operator's `invitations` port hands over each personal link to mail (no mailer ships). The conformance kit adds the scenarios `team.roster` and `team.waits`.

### Patch Changes

- [#138](https://github.com/mostra-dev/mostra/pull/138) [`3fff053`](https://github.com/mostra-dev/mostra/commit/3fff0532a12871760a3c1ba4d34d0aa95e50c12b) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `verify` renders a page once more, in a fresh browser context, when one of the page's requests failed because the browser itself couldn't make the connection (`net::ERR_NO_BUFFER_SPACE`, Chromium's random local port colliding on Windows, [#132](https://github.com/mostra-dev/mostra/issues/132)), so a collision never becomes a failed-request error the artifact didn't cause. The second render's findings are the verdict's, and the supervisor's log records the second render.

## 0.11.0

### Minor Changes

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`fad4595`](https://github.com/mostra-dev/mostra/commit/fad459525cf1ee74c6fc47960c733f34bc3a81ea) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - An always-on owner instance links to a remote server with a key the server's operator issued for an account: `remote/link` (and `mostra login <server> --key-file <file>`), the server's `POST /link`, and the key kept owner-only and sent as the binding's bearer token.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`91bb507`](https://github.com/mostra-dev/mostra/commit/91bb5079056db241ae5b2fd7cbc743a590c616be) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `@mostra/protocol/operator`: the remote server's operator ports (`limits`, `metering`, `identity`, `accounts`, `abuse`, `policy`, `routing`, `events`, `invitations` reserved), the server handle, identity providers and the schemas the server checks every operator answer against, so an operating layer imports nothing else of Mostra.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`312f1c2`](https://github.com/mostra-dev/mostra/commit/312f1c22811cbf53075a215ca71de9cbfcefd6f1) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Pausing, and the remote server's operator boundary (WP-30, RM-09, HO-09):
  
  - `mostra pause <artifact> [--reason <text>]` and `mostra resume <artifact>` (`artifact/pause`): a paused artifact stays viewable and its links keep working, while submissions answer 423 `MOSTRA_SUBMIT_PAUSED` and actions 423 `MOSTRA_ACTION_PAUSED`, keeping the draft. On an owner instance the pause also goes to every server the artifact is hosted on; a pause the server's operator made is lifted only by the operator (`MOSTRA_REMOTE_PAUSED_BY_OPERATOR`).
  - `mostra-runtime server` loads an operator module (`operator` in its configuration) and calls its ports with their time limits and no-op defaults: `limits` (shares, pushes and links fail closed with `MOSTRA_REMOTE_OPERATOR_UNAVAILABLE` when it doesn't answer, while views and answers proceed), `metering` and `events` (at least once, with stable IDs, across restarts), `abuse` (the shell's report control and the after-push hook), `policy` (interstitial, footer, after-submit line, link lifetimes), `routing` (hosts and link hosts an operator supplies, recorded for one home forever) and the server handle (quarantine, pause, suspension, link revocation, moving and restoring homes, removal), each acting on one hosted route or home only.
  - Hosted links minted without a viewer act as one anonymous viewer per browser; per-IP and per-link submission rates (`rateLimits`) answer 429 `MOSTRA_REMOTE_RATE_LIMITED` with `Retry-After`; `X-Forwarded-For` is believed only from `trustedProxies`, read from the right, and IPv6 counts per /64.
  - `FrameTicket` gains `paused` and `hosted` (the trusted chrome's facts), `Viewer` and `useViewer()` gain `verified`, and nine diagnostics join the catalog.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`2b95dad`](https://github.com/mostra-dev/mostra/commit/2b95dadd20892c3458598b9b1c161dd7237cb5f6) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The remote MCP server (WP-30, MC-04): `mostra-runtime server` serves `@mostra/mcp`'s tools at `<apiOrigin>/mcp` over Streamable HTTP behind its authorization server, for the account a token names. Reading tools act on the account's hosted home; `artifact_create`, `artifact_verify`, `artifact_publish` and the workspace's files are relayed to the account's default owner instance (`port/relay.author`), inside its MCP workspace, and answer `MOSTRA_REMOTE_NO_INSTANCE` while none is connected; a publish answers the hosted link. `@mostra/mcp` gains `createAuthorizedEndpoint` and the bundled reference reader (`fileDocs`, `docsIndex`, `topicMarkdown`), which `mostra docs` now uses too.

### Patch Changes

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`9964a88`](https://github.com/mostra-dev/mostra/commit/9964a881a2a7d57738bbc0691711982f13f0aea1) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The hosted shell's trusted chrome (D161, WP-30): the sender line with the provider that verified the owner's name, the viewer with "Sign in" from the chrome (its state bound to the page's route and session, its code redeemed only there) and an anonymous viewer's own unverified name, "Never enter passwords on this page." and the report control in the footer, the paused notice, an operator's interstitial, after-submit line and made-with link, and plain pages for a page under review, a suspended account or a page moving. Every shell page now requires Trusted Types. A hosted submission refused for a rate, a limit, a pause or sign-in says so and keeps the draft.

## 0.10.0

### Minor Changes

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`f0b3cdc`](https://github.com/mostra-dev/mostra/commit/f0b3cdc5156956282d628942419b8d500673c4f6) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A remote server serves hosted pages: `mostra share <artifact> --cloud` (the host protocol's `share/start { via: "remote" }`) pushes the latest version and mints a link on the hosted home, `https://<domain>/a/<routeId>#t=…`; the shell lives on the user-content domain's apex with its session in the `X-Mostra-Shell` header (`SHELL_SESSION_HEADER`), never a cookie, and frames on the route's own label in worker mode. A respondent there sees "Your answer was sent." and no delivery state; the owner instance receives the submission through its outbox. `share/list` and `share/stop` include remote shares, and a stopped one's hosted link is revoked. `VersionPush` carries the owner's submission policy in force.

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`6dbd51b`](https://github.com/mostra-dev/mostra/commit/6dbd51be267212240fd33a4b109ffeb62c503375) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra login [<server>] [--default]` signs this machine in to a remote server by the device grant, `mostra logout [<server>] [--forget]` signs it out (keeping its instance link unless `--forget`), and `mostra share <artifact> --cloud [<server>]` hosts the artifact there. `mostra status` lists the linked servers (`instance/status` gains `links`), and `remote/login` takes `default` to make this instance the account's default.

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`93c04c1`](https://github.com/mostra-dev/mostra/commit/93c04c1890ebeb56d6abc7bcd2d5f2d139ae3ee5) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - An instance signs in to a remote server by the device grant (`remote/login`, `remote/login.wait`, `remote/logout`, `remote/status`), keeps its refresh token in the home, dials the server's binding and keeps it. Submissions its hosted home delivers are stored with their IDs, digest and snapshot and reach this instance's own hosts through its outbox; events of the artifacts it owns are copied once each, with `origin`. `useViewer().source` and `ViewerKind` gain `account` and `anonymous`, `EventRecord` and `Results.submission` gain `origin`, and a delivery envelope may carry the stored `snapshot` and its `cursor`.

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`eec2d62`](https://github.com/mostra-dev/mostra/commit/eec2d6251a6e4b3300745cc2565668e51642d9c3) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Portable bundles: `mostra export <artifact> --out <path>` writes a published version (its builds, manifest, lockfile and source snapshot) as a directory or one `.tar.zst`, and `mostra run <bundle>` makes it the same version in another home, with the same artifact ID, version ID and digests, its server code running there. An import checks every digest, and that the manifest it records is the one its source declares, before it keeps anything (`MOSTRA_ARTIFACT_BUNDLE_INVALID`). New host protocol methods: `artifact/export` and `artifact/import`.

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`e023f3f`](https://github.com/mostra-dev/mostra/commit/e023f3f651765a201400b4b5b09ef35963619100) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The relay: a hosted page's action runs and plain calls run on the artifact's owner instance, with its own secrets, over its binding (`port/relay.run`, `cancel`, `reconcile`, `call`; `relay/run.update`, `relay/call.batch`). While the owner is offline a run waits (`RunStatus` gains `waiting` in use and `unknown`), as the manifest's `hosted.offline` says: `queue` (up to its limit, then `failed` with reason `owner-offline`) or `fail` (at once), in a queue capped per artifact (`MOSTRA_REMOTE_QUEUE_FULL`) that drains in order at a bounded rate when the owner returns. A run the owner never reported within the limit is `unknown`, and its reported end replaces it once; after every reconnect the owner's accepted runs are reconciled before anything drains, and an owner restored to before runs it accepted makes them `unknown`. `RunState.ownerUnreachable` marks a running run whose owner is out of reach. By default only a signed-in viewer or a link minted for a named person may trigger a relayed action (`hosted.actions`, `MOSTRA_REMOTE_SIGN_IN_REQUIRED`). Hosted pages read their tallies. In `@mostra/react`, `run()` rejects for an `unknown` run, which keeps following for its owner's report.
  
  Server code's signals, host events and shared state in a relayed run act on the hosted home (`relay/effect`; `state/patch`'s `causation`), and so do the owner's own `state/*` and `live/push` of a hosted artifact. A hosted page's live sources run on its owner while someone views (`port/relay.live`, `relay/live.value`), redacted before they leave; `LiveState.ownerOffline` marks a value its producer can't refresh while the owner is away.
  
  A server's `rateLimits.perLink.relayedRuns` limits each link's relayed actions: past it a page gets 429 `MOSTRA_REMOTE_RATE_LIMITED` with `Retry-After`, before anything is recorded or relayed.
  
  A relayed run its owner refuses before recording it ends `failed` with reason `owner-refused`; one the connected owner never answered is sent again, which joins the owner's record if it has one.
  
  After its review: a hosted push's listing paths are checked for every system the server runs on; a binding with ports must name its own instance link; the newest session of a link is its own, and a failed reconcile is tried again; a run never ends without the output the relay lost; an expired waiting run is never sent; an `unknown` run is reconciled until the owner's end replaces it; a cancel pressed during an acknowledgement reaches the owner; followed pages and lost submissions survive a reconnect; a restore is told once; a refused push no longer blocks later ones; live values reach every server hosting an artifact.

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`bb061a2`](https://github.com/mostra-dev/mostra/commit/bb061a2a17239d93bfedb13cba3654503da04f4c) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The remote server signs instances in and hosts their versions (WP-29, D165): `mostra-runtime
  server` gains the device authorization grant (`/oauth/device`, `/oauth/token`, `/oauth/revoke`,
  a device page that says approving links a machine, and a development identity provider for tests
  and first runs), with tokens kept only as hashes and refresh tokens that rotate; the network
  binding, the host protocol as JSON-RPC over WebSocket at `/host` with a bearer token, one message
  per frame up to the line limit, a ping and `mostra/ping` every 20 s and a 45 s silence limit, an
  in-band token refresh (`remote/token`) and a close within 60 s of a revoked grant; and
  `hosted/push` with version files over HTTPS (`PUT /files/<sha256>`), which stores only the client
  files a pending push names as missing, checks the listing against the output digest and never
  stores server code. The protocol adds the methods `remote/login`, `remote/login.wait`,
  `remote/logout`, `remote/status`, `remote/token` and `hosted/push`, `RemoteLink`, the `acct_`,
  `hom_`, `lnk_` and `rte_` IDs, `mostra/initialize`'s `link` and `InstanceInfo`'s `hosted` mode,
  `share/start`'s `via: "remote"` and `server`, and the `MOSTRA_REMOTE_*` diagnostics a hosted
  artifact's owner and viewers meet.

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`09ebb64`](https://github.com/mostra-dev/mostra/commit/09ebb643f70362a4170e6e7b03b2ac5848b11d7b) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra-runtime server --data <dir> [--config <file>] [--listen <host:port>]` starts the remote server's core: it holds its data directory with a lock the operating system releases when the process ends, so a second server refuses it and a crashed one never leaves it locked; it refuses a data directory on a network filesystem (`MOSTRA_HOME_NETWORK_FILESYSTEM`) and a configuration it can't use, naming the key (`MOSTRA_REMOTE_CONFIG_INVALID`); and it routes requests by their exact `Host`. New diagnostic area: `REMOTE`.

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`622ac47`](https://github.com/mostra-dev/mostra/commit/622ac475f0a58e7508925724ed7e51f4b90fe50c) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A hosted home restored from a backup rotates its incarnation: after `mostra-runtime server --restored <homeId|all>`, when it opens below the high-water marks the server recorded for it, and when its owner instance reconnects with a committed cursor or relay mark above what it holds. The owner then continues after the restored head, keeps what it imported and records `remote.regressed`; a page whose cursor is past the head reads a fresh snapshot.
  
  An owner instance whose home was restored from a backup reads the hosted submissions it lost again (`hosted/submission`) and imports each once, with its IDs and digest.

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`b9e6780`](https://github.com/mostra-dev/mostra/commit/b9e67808da7d67cba596d9f1019ed83aa69acfb0) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Counts by choice: a manifest's `tally` names a fixed-choice field, and Mostra counts each accepted submission's choice in the submit transaction and pushes the counts to viewers under `useLive("$tally/<field>")`, with no server code. A value outside the listed choices counts nothing, and below `minTotal` viewers see only the total. The manifest also takes `hosted`, the settings a remote server reads. A page that long-polls (behind a quick tunnel) now hears of an action's end at once, instead of up to 20 seconds later, because the shell's own poll of the same view no longer takes the page's run updates ([#119](https://github.com/mostra-dev/mostra/issues/119)).

## 0.9.0

### Minor Changes

- [#120](https://github.com/mostra-dev/mostra/pull/120) [`1c414a8`](https://github.com/mostra-dev/mostra/commit/1c414a854fc8c205e24c7220d6da97945b7b820a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Mostra's MCP server, `@mostra/mcp`: thirteen tools (`artifact_create`, `artifact_write`, `artifact_patch`, `artifact_verify`, `artifact_publish`, `artifact_open`, `artifact_wait`, `artifact_results`, `artifact_list`, `live_push`, `state_get`, `state_patch`, `docs_search`), the reference and artifact reports as resources, and instructions for the loop, independent of the transport. `@mostra/protocol`'s request checks gain the `rpc` intent (a program's JSON-RPC POST with a bearer token) and the diagnostics `MOSTRA_ARTIFACT_PATH_INVALID`, `MOSTRA_ARTIFACT_PATCH_REJECTED`, `MOSTRA_ARTIFACT_ID_DROPPED` (a warning when a write removes the entry's artifact id) and `MOSTRA_ENV_RUNTIME_INSTALLING`.

### Patch Changes

- [#120](https://github.com/mostra-dev/mostra/pull/120) [`9b2acf9`](https://github.com/mostra-dev/mostra/commit/9b2acf916a9fd762a62b6c087f560c541e742755) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On a page whose submission policy is `none`, `results` says it takes no submissions and points at its shared state and signals, and the MCP server's artifact report shows that state; `mostra wait --until signal:<name>` prints the signal's name and payload ([#115](https://github.com/mostra-dev/mostra/issues/115)).

## 0.8.0

### Patch Changes

- [#108](https://github.com/mostra-dev/mostra/pull/108) [`895e62a`](https://github.com/mostra-dev/mostra/commit/895e62aa1a6bcd275173ab2285953a3e56a377e7) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `useLive` stays `isLoading` until a source's first value or error arrives, when the artifact's producer is loading it. A source whose producer hadn't produced yet was reported loaded with no data, so a page could render (or crash on) a missing value, and `verify` judged and screenshotted the page before its data arrived. The gateway says which sources a first load is on its way for (`LiveState.awaiting`, additive), so a key only `mostra push` writes, or a source that only streams, is never waited for.

## 0.7.0

### Minor Changes

- [#100](https://github.com/mostra-dev/mostra/pull/100) [`7b65b43`](https://github.com/mostra-dev/mostra/commit/7b65b43fefc04527229abcb77fb04385a4a2b02a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Sharing (D158). `mostra share <artifact> --tailnet` opens an artifact to the people of your tailnet through Tailscale Serve, each known by their tailnet identity; `mostra share <artifact> --public` opens it to anyone holding the link through a Cloudflare quick tunnel (or Tailscale Funnel with `--via funnel`), for 1 hour by default and 7 days at most. `mostra share stop` and `mostra share list` end and list shares; the host protocol has `share/start`, `share/stop` and `share/list`, and `instance/status` reports active shares, which keep a daemon running. Each tunnel address is a gateway face of its own on loopback, so a request is judged by the socket it came through, never by its `Host`. Frames on another site than their shell (a Cloudflare share, a host's external bases) enter in worker mode: a bootstrap page, Mostra's service worker, and single-use tickets for event streams, long polls and WebSockets; where a tunnel holds streams back, pages long-poll. Hosts get the `addressing` port (`port/addressing.externalBase`, HO-10) in the SDK, the Rust crate and the conformance kit, whose new `ports.addressing` scenario, and the shares in `ports.identity`, run through local stand-ins for `tailscale` and `cloudflared`.

## 0.6.2

### Patch Changes

- [#94](https://github.com/mostra-dev/mostra/pull/94) [`e33361f`](https://github.com/mostra-dev/mostra/commit/e33361ff9c886b81daf1dada40ff481444f92cb0) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `@mostra/protocol` declares Node.js 22.19 or later, as the CLI, the SDK, `create-mostra` and the conformance kit that depend on it do, so npm on Node.js 22 no longer warns `EBADENGINE` when it installs them ([#92](https://github.com/mostra-dev/mostra/issues/92)). Nothing else changes: the protocol package already ran there.

## 0.6.1

### Patch Changes

- [#90](https://github.com/mostra-dev/mostra/pull/90) [`753f3de`](https://github.com/mostra-dev/mostra/commit/753f3deed9bef96c96b671c4973fd799bedb2b81) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Dependency updates, each past its 7-day release age: React 19.3.1, React Router 8.5.0, Vite 8.3.4, Zod 4.6.7, `@hono/node-server` 2.1.5, undici 8.12.3, Playwright 1.64.1 (the same browsers as 1.64.0), and in the warm set Base UI 1.9.0, Radix 1.8.1, Motion 14.4.0, TanStack Table 9.3.1 and the other minor and patch releases of its libraries; the installer's pnpm 10.34.7.

## 0.6.0

### Minor Changes

- [#79](https://github.com/mostra-dev/mostra/pull/79) [`dace950`](https://github.com/mostra-dev/mostra/commit/dace950c6ca7004ea7e11f1b07c23e9abea8de18) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The runtime bundle's contract names Windows: `BUNDLE_PLATFORMS` gains `win32-x64` and `win32-arm64` (and `isWindowsBundle`), a bundle asset may be a Windows archive, and the setup marker records the root it was set up at (`root`, optional), since a Windows bundle's junctions point into it.

### Patch Changes

- [#79](https://github.com/mostra-dev/mostra/pull/79) [`ee5a888`](https://github.com/mostra-dev/mostra/commit/ee5a8883ec3cfd8c0f3d849f2b5a78b761e39c4a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `npm create mostra` installs and runs on Windows (x64 and arm64), from the Windows runtime bundles each release now carries with the others. The conformance kit's TypeScript reference host starts on Windows, and `MOSTRA_PLATFORM_UNSUPPORTED`'s hint and page name Windows among the supported platforms. The Rust crate `mostra-host`, released with them, spawns and attaches on Windows too, over the home's named pipe, which it refuses unless your user owns it.

## 0.5.0

### Minor Changes

- [#75](https://github.com/mostra-dev/mostra/pull/75) [`c3c0052`](https://github.com/mostra-dev/mostra/commit/c3c0052183bcc02b27d755001419d1e55a3a8e7f) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A client no longer refuses an answer from a newer Mostra for a value it doesn't know yet. `RpcPeer.call` reads results, and the SDK reads port requests and event pages, through the new `receivable(schema)`: an enum value or a union member a newer instance added within the revision arrives as sent, while everything else is still checked ([#45](https://github.com/mostra-dev/mostra/issues/45)).

### Patch Changes

- [#75](https://github.com/mostra-dev/mostra/pull/75) [`7893700`](https://github.com/mostra-dev/mostra/commit/78937009ac67a4780b3c29017b5e84dd818d6f75) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The JSON-RPC core carries only the six HOST diagnostics it raises, not the whole HOST catalog, so browser bundles that use it are about 2 kB smaller (the core alone from 5.8 to 3.8 kB, brotli) and stop growing with each new HOST code ([#17](https://github.com/mostra-dev/mostra/issues/17)).

- [#75](https://github.com/mostra-dev/mostra/pull/75) [`e48e7aa`](https://github.com/mostra-dev/mostra/commit/e48e7aad93787e3f2a8e41c6088239bcc2f11178) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Security updates: Vite 8.3.3 for the builder (its `launch-editor` could be led to run a command on Windows, GHSA-587h-7wmj-h5pm), Zod 4.6.6 for every wire schema (validating an oversized constrained collection could exhaust memory, GHSA-mrhx-c7xc-m3w5), and undici 8.12.2 for the SDK's bundle downloads (unbounded memory in its EventSource parser, GHSA-4qv8-2p9j-2685).

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
