# @mostra/cli

## 0.13.0

### Patch Changes

- Updated dependencies [[`dcafbe0`](https://github.com/mostra-dev/mostra/commit/dcafbe05617a99f0001356d5344cd234dd5acadc)]:
  - @mostra/protocol@0.13.0
  - @mostra/mcp@0.13.0
  - @mostra/sdk@0.13.0

## 0.12.0

### Minor Changes

- [#138](https://github.com/mostra-dev/mostra/pull/138) [`74888f3`](https://github.com/mostra-dev/mostra/commit/74888f3aaacac9fe215892c97754a4d2f234fe7c) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Teams (WP-31): expected respondents with personal links (`roster/add`, `roster/remove`, `roster/get`), the waits `submitted:all` and `submitted:<N>` with the durable `roster.completed` event, `results/list` for every submission, `useRespondents()` and `usePresence()` with opt-in cursor and selection sharing that is never stored, attribution of shared fields (who, by key, and when), and the manifest's `team.visibility` (`private` unless the artifact opts in). `mostra roster get|add|remove`, `mostra results --all`, `mostra share --cloud --respondent`, and `artifact_wait`'s team conditions. On a remote server, a hosted artifact's roster lives on its hosted home, `roster.completed` reaches the operator's events, and the operator's `invitations` port hands over each personal link to mail (no mailer ships). The conformance kit adds the scenarios `team.roster` and `team.waits`.

### Patch Changes

- Updated dependencies [[`74888f3`](https://github.com/mostra-dev/mostra/commit/74888f3aaacac9fe215892c97754a4d2f234fe7c), [`3fff053`](https://github.com/mostra-dev/mostra/commit/3fff0532a12871760a3c1ba4d34d0aa95e50c12b)]:
  - @mostra/protocol@0.12.0
  - @mostra/mcp@0.12.0
  - @mostra/sdk@0.12.0

## 0.11.0

### Minor Changes

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`fad4595`](https://github.com/mostra-dev/mostra/commit/fad459525cf1ee74c6fc47960c733f34bc3a81ea) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - An always-on owner instance links to a remote server with a key the server's operator issued for an account: `remote/link` (and `mostra login <server> --key-file <file>`), the server's `POST /link`, and the key kept owner-only and sent as the binding's bearer token.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`312f1c2`](https://github.com/mostra-dev/mostra/commit/312f1c22811cbf53075a215ca71de9cbfcefd6f1) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Pausing, and the remote server's operator boundary (WP-30, RM-09, HO-09):
  
  - `mostra pause <artifact> [--reason <text>]` and `mostra resume <artifact>` (`artifact/pause`): a paused artifact stays viewable and its links keep working, while submissions answer 423 `MOSTRA_SUBMIT_PAUSED` and actions 423 `MOSTRA_ACTION_PAUSED`, keeping the draft. On an owner instance the pause also goes to every server the artifact is hosted on; a pause the server's operator made is lifted only by the operator (`MOSTRA_REMOTE_PAUSED_BY_OPERATOR`).
  - `mostra-runtime server` loads an operator module (`operator` in its configuration) and calls its ports with their time limits and no-op defaults: `limits` (shares, pushes and links fail closed with `MOSTRA_REMOTE_OPERATOR_UNAVAILABLE` when it doesn't answer, while views and answers proceed), `metering` and `events` (at least once, with stable IDs, across restarts), `abuse` (the shell's report control and the after-push hook), `policy` (interstitial, footer, after-submit line, link lifetimes), `routing` (hosts and link hosts an operator supplies, recorded for one home forever) and the server handle (quarantine, pause, suspension, link revocation, moving and restoring homes, removal), each acting on one hosted route or home only.
  - Hosted links minted without a viewer act as one anonymous viewer per browser; per-IP and per-link submission rates (`rateLimits`) answer 429 `MOSTRA_REMOTE_RATE_LIMITED` with `Retry-After`; `X-Forwarded-For` is believed only from `trustedProxies`, read from the right, and IPv6 counts per /64.
  - `FrameTicket` gains `paused` and `hosted` (the trusted chrome's facts), `Viewer` and `useViewer()` gain `verified`, and nine diagnostics join the catalog.

### Patch Changes

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`2b95dad`](https://github.com/mostra-dev/mostra/commit/2b95dadd20892c3458598b9b1c161dd7237cb5f6) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The remote MCP server (WP-30, MC-04): `mostra-runtime server` serves `@mostra/mcp`'s tools at `<apiOrigin>/mcp` over Streamable HTTP behind its authorization server, for the account a token names. Reading tools act on the account's hosted home; `artifact_create`, `artifact_verify`, `artifact_publish` and the workspace's files are relayed to the account's default owner instance (`port/relay.author`), inside its MCP workspace, and answer `MOSTRA_REMOTE_NO_INSTANCE` while none is connected; a publish answers the hosted link. `@mostra/mcp` gains `createAuthorizedEndpoint` and the bundled reference reader (`fileDocs`, `docsIndex`, `topicMarkdown`), which `mostra docs` now uses too.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`e0b45ac`](https://github.com/mostra-dev/mostra/commit/e0b45acd4e567861601d8055cc094def5bca468a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Verify recovers from a browser or runner that failed under it ([#106](https://github.com/mostra-dev/mostra/issues/106)): a warm runner launches its browser again when the one it held died, a runner that failed in itself is replaced and the page rendered again on a fresh one, and `MOSTRA_VERIFY_CRASHED` says what the runner reported. Before, one browser lost (a disk that dropped out was the sighting) failed every later verify of that runner within a second.
- Updated dependencies [[`9964a88`](https://github.com/mostra-dev/mostra/commit/9964a881a2a7d57738bbc0691711982f13f0aea1), [`fad4595`](https://github.com/mostra-dev/mostra/commit/fad459525cf1ee74c6fc47960c733f34bc3a81ea), [`91bb507`](https://github.com/mostra-dev/mostra/commit/91bb5079056db241ae5b2fd7cbc743a590c616be), [`312f1c2`](https://github.com/mostra-dev/mostra/commit/312f1c22811cbf53075a215ca71de9cbfcefd6f1), [`2b95dad`](https://github.com/mostra-dev/mostra/commit/2b95dadd20892c3458598b9b1c161dd7237cb5f6)]:
  - @mostra/protocol@0.11.0
  - @mostra/mcp@0.11.0
  - @mostra/sdk@0.11.0

## 0.10.0

### Minor Changes

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`6dbd51b`](https://github.com/mostra-dev/mostra/commit/6dbd51be267212240fd33a4b109ffeb62c503375) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra login [<server>] [--default]` signs this machine in to a remote server by the device grant, `mostra logout [<server>] [--forget]` signs it out (keeping its instance link unless `--forget`), and `mostra share <artifact> --cloud [<server>]` hosts the artifact there. `mostra status` lists the linked servers (`instance/status` gains `links`), and `remote/login` takes `default` to make this instance the account's default.

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`eec2d62`](https://github.com/mostra-dev/mostra/commit/eec2d6251a6e4b3300745cc2565668e51642d9c3) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Portable bundles: `mostra export <artifact> --out <path>` writes a published version (its builds, manifest, lockfile and source snapshot) as a directory or one `.tar.zst`, and `mostra run <bundle>` makes it the same version in another home, with the same artifact ID, version ID and digests, its server code running there. An import checks every digest, and that the manifest it records is the one its source declares, before it keeps anything (`MOSTRA_ARTIFACT_BUNDLE_INVALID`). New host protocol methods: `artifact/export` and `artifact/import`.

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`09ebb64`](https://github.com/mostra-dev/mostra/commit/09ebb643f70362a4170e6e7b03b2ac5848b11d7b) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra-runtime server --data <dir> [--config <file>] [--listen <host:port>]` starts the remote server's core: it holds its data directory with a lock the operating system releases when the process ends, so a second server refuses it and a crashed one never leaves it locked; it refuses a data directory on a network filesystem (`MOSTRA_HOME_NETWORK_FILESYSTEM`) and a configuration it can't use, naming the key (`MOSTRA_REMOTE_CONFIG_INVALID`); and it routes requests by their exact `Host`. New diagnostic area: `REMOTE`.

### Patch Changes

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`f0b3cdc`](https://github.com/mostra-dev/mostra/commit/f0b3cdc5156956282d628942419b8d500673c4f6) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A remote server serves hosted pages: `mostra share <artifact> --cloud` (the host protocol's `share/start { via: "remote" }`) pushes the latest version and mints a link on the hosted home, `https://<domain>/a/<routeId>#t=…`; the shell lives on the user-content domain's apex with its session in the `X-Mostra-Shell` header (`SHELL_SESSION_HEADER`), never a cookie, and frames on the route's own label in worker mode. A respondent there sees "Your answer was sent." and no delivery state; the owner instance receives the submission through its outbox. `share/list` and `share/stop` include remote shares, and a stopped one's hosted link is revoked. `VersionPush` carries the owner's submission policy in force.

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`99bde6a`](https://github.com/mostra-dev/mostra/commit/99bde6ae87522c4b4b2e68fa9e16c2af8bbc5665) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On Windows, reading the telemetry install ID is tried again for up to a second when another process holds the file for a moment, so racing first runs agree on one ID ([#129](https://github.com/mostra-dev/mostra/issues/129)).

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`a76751c`](https://github.com/mostra-dev/mostra/commit/a76751ce4ee736b45de80ea715cab00b0f7d21b9) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra open` says on stderr when it opened no browser and why, and `--browser` opens one from an agent's shell ([#114](https://github.com/mostra-dev/mostra/issues/114)). Under `epochs`, a new round's page no longer shows the last round's "Submitted" card; only the tab that submitted keeps its receipt ([#118](https://github.com/mostra-dev/mostra/issues/118)).

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
- Updated dependencies [[`f0b3cdc`](https://github.com/mostra-dev/mostra/commit/f0b3cdc5156956282d628942419b8d500673c4f6), [`6dbd51b`](https://github.com/mostra-dev/mostra/commit/6dbd51be267212240fd33a4b109ffeb62c503375), [`93c04c1`](https://github.com/mostra-dev/mostra/commit/93c04c1890ebeb56d6abc7bcd2d5f2d139ae3ee5), [`eec2d62`](https://github.com/mostra-dev/mostra/commit/eec2d6251a6e4b3300745cc2565668e51642d9c3), [`e023f3f`](https://github.com/mostra-dev/mostra/commit/e023f3f651765a201400b4b5b09ef35963619100), [`bb061a2`](https://github.com/mostra-dev/mostra/commit/bb061a2a17239d93bfedb13cba3654503da04f4c), [`09ebb64`](https://github.com/mostra-dev/mostra/commit/09ebb643f70362a4170e6e7b03b2ac5848b11d7b), [`622ac47`](https://github.com/mostra-dev/mostra/commit/622ac475f0a58e7508925724ed7e51f4b90fe50c), [`b9e6780`](https://github.com/mostra-dev/mostra/commit/b9e67808da7d67cba596d9f1019ed83aa69acfb0)]:
  - @mostra/protocol@0.10.0
  - @mostra/mcp@0.10.0
  - @mostra/sdk@0.10.0

## 0.9.0

### Minor Changes

- [#120](https://github.com/mostra-dev/mostra/pull/120) [`1b61a16`](https://github.com/mostra-dev/mostra/commit/1b61a16a18e6c90638dae109c13810cfad991f22) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra mcp` runs Mostra's MCP server over stdio, or over Streamable HTTP with `--http` (loopback, a bearer token, the gateway's request checks), on the home's daemon. `--workspace` chooses where relative artifact directories and new artifacts go (default `~/mostra-artifacts`), and `--embedded` marks a server a harness plugin or another host starts, which sends no telemetry. The standalone CLI's telemetry counts each MCP client once per run (`mcp.session`). `mostra docs guide/mcp` is the Skill's new reference for working through the tools. Installed from npm, `mostra mcp` answers its client at once and installs its release's runtime bundle in the background on its first start, since clients give a server only seconds to start; a tool that needs the runtime meanwhile answers `MOSTRA_ENV_RUNTIME_INSTALLING` with how far the install is.

### Patch Changes

- [#110](https://github.com/mostra-dev/mostra/pull/110) [`eab0592`](https://github.com/mostra-dev/mostra/commit/eab059240a66bc8826ec1d4da37fffeb9f6a6247) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra dev` takes a Ctrl-C (or SIGTERM, or Ctrl+Break on Windows) from its first moment: its handlers are in place before the preview starts, so an interrupt that arrives right as the preview is announced stops the session and prints its result instead of ending the process at once.

- [#120](https://github.com/mostra-dev/mostra/pull/120) [`0bc9eb3`](https://github.com/mostra-dev/mostra/commit/0bc9eb3ac8d7fb2b91efab06cb5fa4b01ca6edde) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The MCP server's file tools take only names every system can hold, make no folder for a change they refuse, and act on a file only while its folder is still inside the artifact; `MOSTRA_ARTIFACT_ID_DROPPED` also warns when an entry is deleted or renamed in case; a diff's `a/` and `b/` are dropped only in git's form, and a rename never replaces a file. `mostra mcp --http` reads the `Authorization` scheme without regard to case, refuses a `MOSTRA_MCP_TOKEN` with little variety, and prints a generated token only on stderr, with `--json` too. A client that only lists tools is counted in `mcp.session`, over either transport, and calls that meet a daemon restart together share one new session.

- [#120](https://github.com/mostra-dev/mostra/pull/120) [`9b2acf9`](https://github.com/mostra-dev/mostra/commit/9b2acf916a9fd762a62b6c087f560c541e742755) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On a page whose submission policy is `none`, `results` says it takes no submissions and points at its shared state and signals, and the MCP server's artifact report shows that state; `mostra wait --until signal:<name>` prints the signal's name and payload ([#115](https://github.com/mostra-dev/mostra/issues/115)).
- Updated dependencies [[`0bc9eb3`](https://github.com/mostra-dev/mostra/commit/0bc9eb3ac8d7fb2b91efab06cb5fa4b01ca6edde), [`1c414a8`](https://github.com/mostra-dev/mostra/commit/1c414a854fc8c205e24c7220d6da97945b7b820a), [`9b2acf9`](https://github.com/mostra-dev/mostra/commit/9b2acf916a9fd762a62b6c087f560c541e742755)]:
  - @mostra/mcp@0.9.0
  - @mostra/protocol@0.9.0
  - @mostra/sdk@0.9.0

## 0.8.0

### Minor Changes

- [#108](https://github.com/mostra-dev/mostra/pull/108) [`404bd3d`](https://github.com/mostra-dev/mostra/commit/404bd3d2461368d77115e2bd285e04f221de6add) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra docs guide` prints the guide to writing artifacts, the same text as the Agent Skill: `guide/<name>` for each of its references, `guide/studio.css` for the baseline stylesheet and `guide/examples/<name>` for each example, so an agent whose harness has no Skill reads it through the CLI.

### Patch Changes

- Updated dependencies [[`895e62a`](https://github.com/mostra-dev/mostra/commit/895e62aa1a6bcd275173ab2285953a3e56a377e7)]:
  - @mostra/protocol@0.8.0
  - @mostra/sdk@0.8.0

## 0.7.0

### Minor Changes

- [#100](https://github.com/mostra-dev/mostra/pull/100) [`7b65b43`](https://github.com/mostra-dev/mostra/commit/7b65b43fefc04527229abcb77fb04385a4a2b02a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Sharing (D158). `mostra share <artifact> --tailnet` opens an artifact to the people of your tailnet through Tailscale Serve, each known by their tailnet identity; `mostra share <artifact> --public` opens it to anyone holding the link through a Cloudflare quick tunnel (or Tailscale Funnel with `--via funnel`), for 1 hour by default and 7 days at most. `mostra share stop` and `mostra share list` end and list shares; the host protocol has `share/start`, `share/stop` and `share/list`, and `instance/status` reports active shares, which keep a daemon running. Each tunnel address is a gateway face of its own on loopback, so a request is judged by the socket it came through, never by its `Host`. Frames on another site than their shell (a Cloudflare share, a host's external bases) enter in worker mode: a bootstrap page, Mostra's service worker, and single-use tickets for event streams, long polls and WebSockets; where a tunnel holds streams back, pages long-poll. Hosts get the `addressing` port (`port/addressing.externalBase`, HO-10) in the SDK, the Rust crate and the conformance kit, whose new `ports.addressing` scenario, and the shares in `ports.identity`, run through local stand-ins for `tailscale` and `cloudflared`.

### Patch Changes

- [#100](https://github.com/mostra-dev/mostra/pull/100) [`7b65b43`](https://github.com/mostra-dev/mostra/commit/7b65b43fefc04527229abcb77fb04385a4a2b02a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Telemetry's lock is taken from a crashed process only under a break lock of its own, so a slow breaker can no longer move a live owner's lock aside and bring it back after its owner released it, which held other commands' telemetry up for 10 s ([#98](https://github.com/mostra-dev/mostra/issues/98)).
- Updated dependencies [[`7b65b43`](https://github.com/mostra-dev/mostra/commit/7b65b43fefc04527229abcb77fb04385a4a2b02a)]:
  - @mostra/protocol@0.7.0
  - @mostra/sdk@0.7.0

## 0.6.2

### Patch Changes

- Updated dependencies [[`e33361f`](https://github.com/mostra-dev/mostra/commit/e33361ff9c886b81daf1dada40ff481444f92cb0)]:
  - @mostra/protocol@0.6.2
  - @mostra/sdk@0.6.2

## 0.6.1

### Patch Changes

- Updated dependencies [[`f210c60`](https://github.com/mostra-dev/mostra/commit/f210c600415c9ab61263f13bd7b22ec3e76d8e58), [`753f3de`](https://github.com/mostra-dev/mostra/commit/753f3deed9bef96c96b671c4973fd799bedb2b81), [`a9519df`](https://github.com/mostra-dev/mostra/commit/a9519df6a55bc5887b6a3008b36ab5e6d249fcf1)]:
  - @mostra/sdk@0.6.1
  - @mostra/protocol@0.6.1

## 0.6.0

### Minor Changes

- [#79](https://github.com/mostra-dev/mostra/pull/79) [`e903d95`](https://github.com/mostra-dev/mostra/commit/e903d952bc51fd108c736ae7d4bb4ff610f133dc) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Windows (x64 and arm64) is supported like macOS and Linux: the development switch `MOSTRA_DEV_WINDOWS` is gone, and every other platform still fails closed with `MOSTRA_PLATFORM_UNSUPPORTED`.

### Patch Changes

- Updated dependencies [[`dace950`](https://github.com/mostra-dev/mostra/commit/dace950c6ca7004ea7e11f1b07c23e9abea8de18), [`cf0343a`](https://github.com/mostra-dev/mostra/commit/cf0343a1bb8e66b074a567587395c69a4501aa52), [`9d96c60`](https://github.com/mostra-dev/mostra/commit/9d96c60ebbc7994ea95a408a112580990852ba88), [`7012f26`](https://github.com/mostra-dev/mostra/commit/7012f2605f7ab77c2e0de45218fca0f5b7de61ba), [`ee5a888`](https://github.com/mostra-dev/mostra/commit/ee5a8883ec3cfd8c0f3d849f2b5a78b761e39c4a)]:
  - @mostra/protocol@0.6.0
  - @mostra/sdk@0.6.0

## 0.5.0

### Patch Changes

- [#75](https://github.com/mostra-dev/mostra/pull/75) [`911f8f7`](https://github.com/mostra-dev/mostra/commit/911f8f7b3b036e7c6626088c4b4b44371b641935) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On Windows, when creating the telemetry lock is refused and no lock file is there, the CLI now checks whether it can write its config directory at all (a file of its own) instead of giving up after three such rounds, so a lock other processes keep taking and releasing is waited for until the usual 2 s.
  
  On Windows, the CLI's telemetry settings and queue are replaced with retries for up to a second while another process has the file open, which Windows refuses; before, such a command lost its install ID or its notice (seen in CI with twelve processes starting at once).

- [#75](https://github.com/mostra-dev/mostra/pull/75) [`aa3031f`](https://github.com/mostra-dev/mostra/commit/aa3031f7548aaace9976444d422c4d13813f2c37) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra verify`, `mostra doctor` and `mostra wait` treat a status they don't know, which a newer Mostra may send, as a failure: `verify` exits 0 only on a passing verdict, `doctor` fails on any check that isn't `ok` or `warning`, and `wait` ends with exit 1 instead of waiting again. A telemetry probe file Windows briefly holds no longer interrupts a command.

- [#72](https://github.com/mostra-dev/mostra/pull/72) [`ed8a382`](https://github.com/mostra-dev/mostra/commit/ed8a382e57b9f6b25e34fbd1e04b50ad852d6ff9) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On Windows, a telemetry lock that another process finished deleting just as this one tried to take it no longer makes this process give up without an install ID; a directory this user can't write still gives up within about 60 ms.
- Updated dependencies [[`7893700`](https://github.com/mostra-dev/mostra/commit/78937009ac67a4780b3c29017b5e84dd818d6f75), [`c3c0052`](https://github.com/mostra-dev/mostra/commit/c3c0052183bcc02b27d755001419d1e55a3a8e7f), [`e48e7aa`](https://github.com/mostra-dev/mostra/commit/e48e7aad93787e3f2a8e41c6088239bcc2f11178)]:
  - @mostra/protocol@0.5.0
  - @mostra/sdk@0.5.0

## 0.4.0

### Minor Changes

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`5babe15`](https://github.com/mostra-dev/mostra/commit/5babe15751fe86a9e12ca7165683c8d866808c18) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The CLI admits Windows x64 and arm64 behind the development switch `MOSTRA_DEV_WINDOWS=1`, as the runtime does, and fails closed on any other platform or architecture. On Windows it reaches its daemon's pipe through `connectControl`, defaults its home to `%LOCALAPPDATA%\mostra` and its settings to `%APPDATA%\mostra`, opens links with the default browser through Explorer and reads `$BROWSER` as a `;`-separated list; telemetry reports `win32` as the system, and `mostra doctor` reports Windows as the runtime admits it.

### Patch Changes

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`74db4c1`](https://github.com/mostra-dev/mostra/commit/74db4c1cd9b6d8ed020641d8d846ada4f564d5c5) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The daemon and the telemetry flusher the CLI starts no longer keep the directory the command ran in as their working directory, so on Windows that directory can be renamed or removed while they run. A telemetry config directory that can never exist (a part of its path is a file) reads as unreadable on every system, as it did on macOS and Linux.

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`8786a3e`](https://github.com/mostra-dev/mostra/commit/8786a3ee63ac708207394946a1dd43ea3b1c474c) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra dev` also stops on Ctrl+Break, as a Windows console sends it.

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`c41f76a`](https://github.com/mostra-dev/mostra/commit/c41f76ad11d247e7c115d835f26ccf0e7cb32ec8) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The CLI starts its daemon with an absolute runtime entry, so a relative `MOSTRA_RUNTIME_BIN` works again now that the daemon runs in its file system root, and the telemetry store gives up on a lock it can neither take nor break within its 2 s instead of trying forever.

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`4c70f4b`](https://github.com/mostra-dev/mostra/commit/4c70f4b2272b4194015ab5282eb19014342f2376) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The daemon and the telemetry flusher, which run in their file system's root, get every relative path variable (`MOSTRA_RUNTIME_DIR`, `MOSTRA_HOME` and the rest) resolved against the command's directory. On Windows, a telemetry lock that this user can't create no longer keeps a command busy for 2 s.

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`fd893ae`](https://github.com/mostra-dev/mostra/commit/fd893aee2dbcf801d409054220fd81db251de7d1) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On Windows, `mostra open` writes its launch page under the user's own profile, never under a `%TEMP%` that other users may read. The conformance kit opens an instance's pipe through the SDK's `connectControl`, as every other client does.

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`2f89021`](https://github.com/mostra-dev/mostra/commit/2f89021c078cf5839918c963e6e5146d6ac16a1c) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On Windows, a telemetry store lock that another process has just released no longer makes a command give up on recording its event: the refusal Windows gives while the old lock is still being deleted counts as the lock being held, and the command waits for it as it does elsewhere.

- [#62](https://github.com/mostra-dev/mostra/pull/62) [`127155e`](https://github.com/mostra-dev/mostra/commit/127155ea56afb0ccd1e17d26dddf6a4c98a441dd) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Telemetry events from Windows (`os: "win32"`) are queued: the event schema refused them, so a Windows CLI with telemetry on recorded nothing.
- Updated dependencies [[`fe84a16`](https://github.com/mostra-dev/mostra/commit/fe84a160c095c6dfe29f3ed5c956ae36407c788f), [`973bd3c`](https://github.com/mostra-dev/mostra/commit/973bd3c2d13c63e8d97e25c67ae1a65adcc1f2fd), [`5babe15`](https://github.com/mostra-dev/mostra/commit/5babe15751fe86a9e12ca7165683c8d866808c18)]:
  - @mostra/protocol@0.4.0
  - @mostra/sdk@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`bb00a14`](https://github.com/mostra-dev/mostra/commit/bb00a1474c4737e800d5c38824c3250fe3b43890)]:
  - @mostra/protocol@0.3.0
  - @mostra/sdk@0.3.0

## 0.2.0

### Patch Changes

- [#44](https://github.com/mostra-dev/mostra/pull/44) [`b6ddfa7`](https://github.com/mostra-dev/mostra/commit/b6ddfa7fd59d5ab41bb39a37e303a26cd1e202cc) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra host --help`'s example uses a neutral home path (`~/.my-host/mostra`) instead of naming a particular host.
- Updated dependencies [[`0ff9ae5`](https://github.com/mostra-dev/mostra/commit/0ff9ae5b682ab9b9d5db42b9984d553ce025428b), [`8772efe`](https://github.com/mostra-dev/mostra/commit/8772efeaf48e77765e6c3953c213704dd35c8de5), [`7251965`](https://github.com/mostra-dev/mostra/commit/725196570ed56cf930213d4cffed1093c5863b8e)]:
  - @mostra/protocol@0.2.0
  - @mostra/sdk@0.2.0

## 0.1.0

### Minor Changes

- [#37](https://github.com/mostra-dev/mostra/pull/37) [`ba45dc6`](https://github.com/mostra-dev/mostra/commit/ba45dc6df4b5b42ee2a3ac1d71996ca924d51c20) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra` installed from npm runs on Mostra's own runtime bundle (RT-01): on first use it downloads the bundle its release pins, checks it against its SHA-256 and file list, caches it, then runs the bundle's own `mostra` with the same arguments on the bundle's private Node.js, so the system's Node.js only has to be 22.19 or later; an older one is refused at once with `MOSTRA_ENV_NODE_UNSUPPORTED` (exit 3). Inside a bundle the CLI runs the bundle's runtime with the bundle's Node.js, and `mostra doctor` reports the bundle (`--deep` checks every file and the verify browser against their SHA-256).

- [#29](https://github.com/mostra-dev/mostra/pull/29) [`0a2e3f3`](https://github.com/mostra-dev/mostra/commit/0a2e3f360287c9e608b98e401f53b4d2eb93b2f9) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The first release of `mostra`, the CLI (D60, D140): every WP-10 command, `mostra dev` included, as a thin client of the host protocol with daemon autostart, `--json` envelopes, one exit-code table, generated help and `--help --json`, `mostra docs`, `doctor`, `gc`, and anonymous telemetry for the standalone CLI only, which this build never sends (it has no endpoint).

### Patch Changes

- Updated dependencies [[`c37abca`](https://github.com/mostra-dev/mostra/commit/c37abca1b7d39e72781aac0b01e3a81ef20de0e6), [`f86a1d3`](https://github.com/mostra-dev/mostra/commit/f86a1d33ee3dcff3e32578876d41c423338dbdde), [`db2d46c`](https://github.com/mostra-dev/mostra/commit/db2d46c8d27077de225e73543007c69cf7598ff7), [`2fa9414`](https://github.com/mostra-dev/mostra/commit/2fa94140fa30d0a036efe04e1b750d8db6b82721), [`ea68d0a`](https://github.com/mostra-dev/mostra/commit/ea68d0abc2fa93e372865b0f504a1c4d79c21c57), [`c148a7b`](https://github.com/mostra-dev/mostra/commit/c148a7bd9f3175ef6f44e989354d6583e5e41009), [`f1f7bd0`](https://github.com/mostra-dev/mostra/commit/f1f7bd0c38fc3a7567f6e3a2714fcd064bf4408a), [`a0ba1b6`](https://github.com/mostra-dev/mostra/commit/a0ba1b6349cf537a6086c16dafdbc8305dedeb94), [`67f353c`](https://github.com/mostra-dev/mostra/commit/67f353cd7c13af4ae265279ba91053f77428b7b7), [`dd5648f`](https://github.com/mostra-dev/mostra/commit/dd5648ff254e153b4eac5e8cab61979f725730db), [`ec6a96d`](https://github.com/mostra-dev/mostra/commit/ec6a96d65291e6994fdf786b56bd62cba5418a8a), [`59aaab3`](https://github.com/mostra-dev/mostra/commit/59aaab33455cc9bf8e91bca24d97c1b84123212e), [`66af0b5`](https://github.com/mostra-dev/mostra/commit/66af0b5b54d76c8d0c7c898033a9919ae010d571), [`8bce8c7`](https://github.com/mostra-dev/mostra/commit/8bce8c78f5f0b6b10f9928d8de261961e5b7dc0a), [`0939420`](https://github.com/mostra-dev/mostra/commit/093942093a22792ae14436320ecadaee4f66c0f2), [`7e283c2`](https://github.com/mostra-dev/mostra/commit/7e283c229947cd0904ab95803dc48cc52570ac43)]:
  - @mostra/protocol@0.1.0
  - @mostra/sdk@0.1.0
