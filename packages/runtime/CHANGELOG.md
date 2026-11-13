# @mostra/runtime

## 0.13.0

### Minor Changes

- [#144](https://github.com/mostra-dev/mostra/pull/144) [`dcafbe0`](https://github.com/mostra-dev/mostra/commit/dcafbe05617a99f0001356d5344cd234dd5acadc) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The remote server's operator ports do what INTERFACES §18.6 says, and give an operator more to go on (all additive within `OPERATOR_REVISION` `2026-11-08`):
  
  - `limits` is asked for a hosted page's relayed actions: `run` before a run is recorded, `run.wait` before it waits for an absent owner, `call` before a plain call is relayed. A refusal answers the operator's message (403 `MOSTRA_REMOTE_LIMIT_REACHED`, or 503 `MOSTRA_REMOTE_QUEUE_FULL` for `run.wait`) with nothing recorded or relayed and the link's relayed-action rate given back; a request that joins a recorded run, or a duplicate sent meanwhile, is never asked; no answer lets the action through; and a pause, a revoked link or a closed page during the wait refuses the action then.
  - A link's `idleExpiry` is judged from its last use before the visit that asks (its views and its other sessions' activity), so a fresh visit to an idle link answers 410 and a page open and in use keeps its link.
  - GitHub sign-ins carry `publicRepos`, `publicGists` and `followers` in `SignInIdentity.facts`; an `oidc` entry of `identityProviders` may name `claims` (at most 8, never `__proto__`, `constructor` or `prototype`) that go into `facts` under their names.
  - The sender line's verifier is recorded on each sign-in identity when its provider names the person, so renaming or retiring a configured provider changes no verified name (a label with control or format characters verifies nothing), and `IdentityProvider.verifies: { label }` lets a provider the operator module supplies verify names.
  - Metering adds `bytes.held`, the client bytes a home holds, sent when it changes (falling when content is removed, 0 once when nothing is left) and for every home once a day; a window's counters go out in batches of at most 1,000.
  - `LimitQuery.versionId` names the version on `version.push` and `storage`, the same in every round of one push.

### Patch Changes

- Updated dependencies [[`dcafbe0`](https://github.com/mostra-dev/mostra/commit/dcafbe05617a99f0001356d5344cd234dd5acadc)]:
  - @mostra/protocol@0.13.0
  - @mostra/mcp@0.13.0

## 0.12.0

### Minor Changes

- [#138](https://github.com/mostra-dev/mostra/pull/138) [`74888f3`](https://github.com/mostra-dev/mostra/commit/74888f3aaacac9fe215892c97754a4d2f234fe7c) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Teams (WP-31): expected respondents with personal links (`roster/add`, `roster/remove`, `roster/get`), the waits `submitted:all` and `submitted:<N>` with the durable `roster.completed` event, `results/list` for every submission, `useRespondents()` and `usePresence()` with opt-in cursor and selection sharing that is never stored, attribution of shared fields (who, by key, and when), and the manifest's `team.visibility` (`private` unless the artifact opts in). `mostra roster get|add|remove`, `mostra results --all`, `mostra share --cloud --respondent`, and `artifact_wait`'s team conditions. On a remote server, a hosted artifact's roster lives on its hosted home, `roster.completed` reaches the operator's events, and the operator's `invitations` port hands over each personal link to mail (no mailer ships). The conformance kit adds the scenarios `team.roster` and `team.waits`.

### Patch Changes

- [#138](https://github.com/mostra-dev/mostra/pull/138) [`3fff053`](https://github.com/mostra-dev/mostra/commit/3fff0532a12871760a3c1ba4d34d0aa95e50c12b) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `verify` renders a page once more, in a fresh browser context, when one of the page's requests failed because the browser itself couldn't make the connection (`net::ERR_NO_BUFFER_SPACE`, Chromium's random local port colliding on Windows, [#132](https://github.com/mostra-dev/mostra/issues/132)), so a collision never becomes a failed-request error the artifact didn't cause. The second render's findings are the verdict's, and the supervisor's log records the second render.
- Updated dependencies [[`74888f3`](https://github.com/mostra-dev/mostra/commit/74888f3aaacac9fe215892c97754a4d2f234fe7c), [`3fff053`](https://github.com/mostra-dev/mostra/commit/3fff0532a12871760a3c1ba4d34d0aa95e50c12b)]:
  - @mostra/protocol@0.12.0
  - @mostra/mcp@0.12.0

## 0.11.0

### Minor Changes

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`9964a88`](https://github.com/mostra-dev/mostra/commit/9964a881a2a7d57738bbc0691711982f13f0aea1) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The hosted shell's trusted chrome (D161, WP-30): the sender line with the provider that verified the owner's name, the viewer with "Sign in" from the chrome (its state bound to the page's route and session, its code redeemed only there) and an anonymous viewer's own unverified name, "Never enter passwords on this page." and the report control in the footer, the paused notice, an operator's interstitial, after-submit line and made-with link, and plain pages for a page under review, a suspended account or a page moving. Every shell page now requires Trusted Types. A hosted submission refused for a rate, a limit, a pause or sign-in says so and keeps the draft.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`e0f9a57`](https://github.com/mostra-dev/mostra/commit/e0f9a57e41ff5ff6e78f2340bfe8f0336024b98d) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Hosted pages show one link preview for every artifact ("A page sent with Mostra", `noindex`), or the title alone when the manifest sets `hosted.preview: "title"` (D161). The remote server accepts up to 1 MiB of request headers, so a sibling page filling the cookie jar never costs a hosted page its session, and a hosted frame's documents name the same framers as its refusals, an operator's outside hosts included.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`fad4595`](https://github.com/mostra-dev/mostra/commit/fad459525cf1ee74c6fc47960c733f34bc3a81ea) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - An always-on owner instance links to a remote server with a key the server's operator issued for an account: `remote/link` (and `mostra login <server> --key-file <file>`), the server's `POST /link`, and the key kept owner-only and sent as the binding's bearer token.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`312f1c2`](https://github.com/mostra-dev/mostra/commit/312f1c22811cbf53075a215ca71de9cbfcefd6f1) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Pausing, and the remote server's operator boundary (WP-30, RM-09, HO-09):
  
  - `mostra pause <artifact> [--reason <text>]` and `mostra resume <artifact>` (`artifact/pause`): a paused artifact stays viewable and its links keep working, while submissions answer 423 `MOSTRA_SUBMIT_PAUSED` and actions 423 `MOSTRA_ACTION_PAUSED`, keeping the draft. On an owner instance the pause also goes to every server the artifact is hosted on; a pause the server's operator made is lifted only by the operator (`MOSTRA_REMOTE_PAUSED_BY_OPERATOR`).
  - `mostra-runtime server` loads an operator module (`operator` in its configuration) and calls its ports with their time limits and no-op defaults: `limits` (shares, pushes and links fail closed with `MOSTRA_REMOTE_OPERATOR_UNAVAILABLE` when it doesn't answer, while views and answers proceed), `metering` and `events` (at least once, with stable IDs, across restarts), `abuse` (the shell's report control and the after-push hook), `policy` (interstitial, footer, after-submit line, link lifetimes), `routing` (hosts and link hosts an operator supplies, recorded for one home forever) and the server handle (quarantine, pause, suspension, link revocation, moving and restoring homes, removal), each acting on one hosted route or home only.
  - Hosted links minted without a viewer act as one anonymous viewer per browser; per-IP and per-link submission rates (`rateLimits`) answer 429 `MOSTRA_REMOTE_RATE_LIMITED` with `Retry-After`; `X-Forwarded-For` is believed only from `trustedProxies`, read from the right, and IPv6 counts per /64.
  - `FrameTicket` gains `paused` and `hosted` (the trusted chrome's facts), `Viewer` and `useViewer()` gain `verified`, and nine diagnostics join the catalog.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`2b95dad`](https://github.com/mostra-dev/mostra/commit/2b95dadd20892c3458598b9b1c161dd7237cb5f6) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The remote MCP server (WP-30, MC-04): `mostra-runtime server` serves `@mostra/mcp`'s tools at `<apiOrigin>/mcp` over Streamable HTTP behind its authorization server, for the account a token names. Reading tools act on the account's hosted home; `artifact_create`, `artifact_verify`, `artifact_publish` and the workspace's files are relayed to the account's default owner instance (`port/relay.author`), inside its MCP workspace, and answer `MOSTRA_REMOTE_NO_INSTANCE` while none is connected; a publish answers the hosted link. `@mostra/mcp` gains `createAuthorizedEndpoint` and the bundled reference reader (`fileDocs`, `docsIndex`, `topicMarkdown`), which `mostra docs` now uses too.

### Patch Changes

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`28eaedd`](https://github.com/mostra-dev/mostra/commit/28eaedd10e789745d20329a319abd79784d4464b) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A Client ID Metadata Document is never fetched from an IPv6 address that carries a private or loopback IPv4 one (mapped, compatible, NAT64, 6to4), however it is written.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`7206a92`](https://github.com/mostra-dev/mostra/commit/7206a92d0ebf5586747b2c7edcef82b7b281e8dc) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - An authorization code presented a second time revokes the grant its first presentation made, and a token request needs `redirect_uri` only when the authorization request named it (OAuth 2.1 §4.1.3).

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`fb0506e`](https://github.com/mostra-dev/mostra/commit/fb0506e60c21c2cc33b471817b254e21c0941c03) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A stopping gateway listener, and the remote server, reset their open connections instead of closing them ([#132](https://github.com/mostra-dev/mostra/issues/132)): a connection the server closed first stayed in TIME_WAIT on its port, where a browser's next connect from the same random port failed on Windows with `ERR_NO_BUFFER_SPACE`, the more so as a restarted instance listens on the same leased ports.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`b9bea94`](https://github.com/mostra-dev/mostra/commit/b9bea94ba3edf30b08e00f087ecde8c4f00d94b2) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A Client ID Metadata Document is fetched again: the fetch's own DNS lookup answered Node.js with one address when it asked for all of them (its happy-eyeballs connect), so every document failed with "Invalid IP address: undefined" (found by claude.ai's connector). The hosted shell tells the viewer when it couldn't store its session, and that a reload will need the link again.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`e122242`](https://github.com/mostra-dev/mostra/commit/e122242f33a58ec89b2ce7187fee3458e7d7c4e0) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - An identity provider's calls are bounded inside the authorization server's 10 s, an operator's provider that names nobody signs nobody in, and the device page offers an operator's providers.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`41bd1e0`](https://github.com/mostra-dev/mostra/commit/41bd1e0dad80a5988160402de85f443803286dc4) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Dynamic Client Registration is limited to a few clients a minute per address, with `Retry-After`.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`53f2029`](https://github.com/mostra-dev/mostra/commit/53f2029256406166dffe9eadc6ab7263a3b18f5d) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Relayed authoring sends the server none of the owner's own links: a publish's receipt crosses without its local default link, a directory lookup answers only the artifact's ID and title, and a screenshot is read only where its path really leads inside verify's cache.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`2648650`](https://github.com/mostra-dev/mostra/commit/26486507127146ec15123d6190f1f5c8a746e9b7) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A submit that repeats a recorded one, or that its view or a pause refuses, isn't admitted by a hosted home's rates or the operator's limits, and the per-IP and per-link rates are taken together or not at all; the code grant leaves a token that isn't a code alone; a relayed screenshot is only a PNG verify wrote.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`7f9f01b`](https://github.com/mostra-dev/mostra/commit/7f9f01b2407f91b9e0573f694cebb70b03dc0fff) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `ServerHandle.remove` records its plan in the directory first, so a removal cut off between the home's ledger and the directory is finished by the next call; the route serves nothing meanwhile and takes no push.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`5eae2bd`](https://github.com/mostra-dev/mostra/commit/5eae2bd44faf09d952809a8abdfaa6a4f44fb4f5) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The sizes a pushed listing gives its client files, which the operator's storage limit is asked with, are held to the bytes: one size per file, a held file's size on disk, and an upload refused (with its answer, before its connection closes) when it brings another size.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`394e2ee`](https://github.com/mostra-dev/mostra/commit/394e2eefda274e211c34d86e557f717e2b421f9e) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A suspended home or account acts nowhere (`/host`, `/files`, `/mcp`, `/link`): the operator's `accounts.status` is asked and reaches grants, refreshes and bindings; the development form approves a device code only as `accounts.resolve` decides and only where it is offered; an operator's key used on `/mcp` or `/files` links no instance; an owner's pause and an operator's are kept apart (ledger migration 15).

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`27df61b`](https://github.com/mostra-dev/mostra/commit/27df61b518428bf70887dadc70d6230f01f766c1) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A suspended account's refresh is refused for now (403 `temporarily_unavailable`), never as a sign-out; a hosted submit takes its rates before the operator's `limits` is asked and gets them back when the operator refuses; `rateLimits.perIp.requests` is applied to every request; the development device form checks the code before it resolves anyone; a hosted shell whose session isn't stored offers no sign-in.

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`e0b45ac`](https://github.com/mostra-dev/mostra/commit/e0b45acd4e567861601d8055cc094def5bca468a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Verify recovers from a browser or runner that failed under it ([#106](https://github.com/mostra-dev/mostra/issues/106)): a warm runner launches its browser again when the one it held died, a runner that failed in itself is replaced and the page rendered again on a fresh one, and `MOSTRA_VERIFY_CRASHED` says what the runner reported. Before, one browser lost (a disk that dropped out was the sighting) failed every later verify of that runner within a second.
- Updated dependencies [[`9964a88`](https://github.com/mostra-dev/mostra/commit/9964a881a2a7d57738bbc0691711982f13f0aea1), [`fad4595`](https://github.com/mostra-dev/mostra/commit/fad459525cf1ee74c6fc47960c733f34bc3a81ea), [`91bb507`](https://github.com/mostra-dev/mostra/commit/91bb5079056db241ae5b2fd7cbc743a590c616be), [`312f1c2`](https://github.com/mostra-dev/mostra/commit/312f1c22811cbf53075a215ca71de9cbfcefd6f1), [`2b95dad`](https://github.com/mostra-dev/mostra/commit/2b95dadd20892c3458598b9b1c161dd7237cb5f6)]:
  - @mostra/protocol@0.11.0
  - @mostra/mcp@0.11.0

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

### Patch Changes

- [#128](https://github.com/mostra-dev/mostra/pull/128) [`e0d2ab8`](https://github.com/mostra-dev/mostra/commit/e0d2ab8d68d8e3537d50e8a55375e51f0d44e064) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `useLive` reports `ownerOffline: true` on a hosted page while the page's owner is offline, so its producer can't refresh the value: `data` stays the last value, from `at`. The Skill's sharing reference covers the `hosted` manifest key and what `waiting` and `unknown` runs mean.
  
  A publish made after the owner's link had nothing left to push now reaches its servers: the push queue's drain no longer stays registered once it ended before its first await. A share to two servers hosts the artifact on both, and their answers reach the owner with their own origin.
- Updated dependencies [[`f0b3cdc`](https://github.com/mostra-dev/mostra/commit/f0b3cdc5156956282d628942419b8d500673c4f6), [`6dbd51b`](https://github.com/mostra-dev/mostra/commit/6dbd51be267212240fd33a4b109ffeb62c503375), [`93c04c1`](https://github.com/mostra-dev/mostra/commit/93c04c1890ebeb56d6abc7bcd2d5f2d139ae3ee5), [`eec2d62`](https://github.com/mostra-dev/mostra/commit/eec2d6251a6e4b3300745cc2565668e51642d9c3), [`e023f3f`](https://github.com/mostra-dev/mostra/commit/e023f3f651765a201400b4b5b09ef35963619100), [`bb061a2`](https://github.com/mostra-dev/mostra/commit/bb061a2a17239d93bfedb13cba3654503da04f4c), [`09ebb64`](https://github.com/mostra-dev/mostra/commit/09ebb643f70362a4170e6e7b03b2ac5848b11d7b), [`622ac47`](https://github.com/mostra-dev/mostra/commit/622ac475f0a58e7508925724ed7e51f4b90fe50c), [`b9e6780`](https://github.com/mostra-dev/mostra/commit/b9e67808da7d67cba596d9f1019ed83aa69acfb0)]:
  - @mostra/protocol@0.10.0

## 0.9.0

### Patch Changes

- [#120](https://github.com/mostra-dev/mostra/pull/120) [`9b2acf9`](https://github.com/mostra-dev/mostra/commit/9b2acf916a9fd762a62b6c087f560c541e742755) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On a page whose submission policy is `none`, `results` says it takes no submissions and points at its shared state and signals, and the MCP server's artifact report shows that state; `mostra wait --until signal:<name>` prints the signal's name and payload ([#115](https://github.com/mostra-dev/mostra/issues/115)).
- Updated dependencies [[`1c414a8`](https://github.com/mostra-dev/mostra/commit/1c414a854fc8c205e24c7220d6da97945b7b820a), [`9b2acf9`](https://github.com/mostra-dev/mostra/commit/9b2acf916a9fd762a62b6c087f560c541e742755)]:
  - @mostra/protocol@0.9.0

## 0.8.0

### Minor Changes

- [#108](https://github.com/mostra-dev/mostra/pull/108) [`9e0fe3c`](https://github.com/mostra-dev/mostra/commit/9e0fe3cc2d2e2534ac3ec31d0bb45029b94237e8) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - `mostra new` (`artifact/create`) also writes an `AGENTS.md` with the artifact's loop (verify, publish, wait, results), its rules and where the guide is, pinned to this release's CLI, and a `CLAUDE.md` that imports it, so the next agent working in the directory knows how to finish the artifact. `files` lists all three; a retried creation completes them as it completes the entry.

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

- [#94](https://github.com/mostra-dev/mostra/pull/94) [`c6f49b9`](https://github.com/mostra-dev/mostra/commit/c6f49b9bbc55cf318e55fad7ce530276e1b8960f) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The gateway keeps an idle connection open for 305 s instead of Node's 5 s, longer than Chromium (300 s) and Firefox (115 s) keep theirs, so browsers reuse their connections and close them themselves. On Windows 11, Chromium's random local ports collided with the connections the gateway had closed, and a frame occasionally failed to load with `ERR_NO_BUFFER_SPACE` ([#66](https://github.com/mostra-dev/mostra/issues/66), D157).
- Updated dependencies [[`e33361f`](https://github.com/mostra-dev/mostra/commit/e33361ff9c886b81daf1dada40ff481444f92cb0)]:
  - @mostra/protocol@0.6.2

## 0.6.1

### Patch Changes

- [#90](https://github.com/mostra-dev/mostra/pull/90) [`753f3de`](https://github.com/mostra-dev/mostra/commit/753f3deed9bef96c96b671c4973fd799bedb2b81) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Dependency updates, each past its 7-day release age: React 19.3.1, React Router 8.5.0, Vite 8.3.4, Zod 4.6.7, `@hono/node-server` 2.1.5, undici 8.12.3, Playwright 1.64.1 (the same browsers as 1.64.0), and in the warm set Base UI 1.9.0, Radix 1.8.1, Motion 14.4.0, TanStack Table 9.3.1 and the other minor and patch releases of its libraries; the installer's pnpm 10.34.7.

- [#90](https://github.com/mostra-dev/mostra/pull/90) [`b267c4b`](https://github.com/mostra-dev/mostra/commit/b267c4b263a2e864ed7e9891917760e7e2041d6e) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A `mostra dev` session whose connection closes while it starts no longer takes the instance down: the start stops the dev server it was starting before it removes the session's directory, and a cleanup that fails is reported, never an uncaught error ([#35](https://github.com/mostra-dev/mostra/issues/35)). An instance that does stop on an uncaught error now records the error and where it was thrown in the home's log.

- [#90](https://github.com/mostra-dev/mostra/pull/90) [`0c9d1f2`](https://github.com/mostra-dev/mostra/commit/0c9d1f2c5f6335fa5dc993364c362c01ea487f93) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The runtime bundles ship Node.js 24.22.1, a security release of the 24 LTS line (fixes in http, dns, tls, the permission model, crypto and brotli; OpenSSL 3.5.9), pinned by the SHA-256s of its signed `SHASUMS256.txt`.
- Updated dependencies [[`753f3de`](https://github.com/mostra-dev/mostra/commit/753f3deed9bef96c96b671c4973fd799bedb2b81)]:
  - @mostra/protocol@0.6.1

## 0.6.0

### Minor Changes

- [#79](https://github.com/mostra-dev/mostra/pull/79) [`e903d95`](https://github.com/mostra-dev/mostra/commit/e903d952bc51fd108c736ae7d4bb4ff610f133dc) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Windows (x64 and arm64) is supported like macOS and Linux: the development switch `MOSTRA_DEV_WINDOWS` is gone, and every other platform still fails closed with `MOSTRA_PLATFORM_UNSUPPORTED`.

### Patch Changes

- Updated dependencies [[`dace950`](https://github.com/mostra-dev/mostra/commit/dace950c6ca7004ea7e11f1b07c23e9abea8de18), [`ee5a888`](https://github.com/mostra-dev/mostra/commit/ee5a8883ec3cfd8c0f3d849f2b5a78b761e39c4a)]:
  - @mostra/protocol@0.6.0

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
