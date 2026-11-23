# @mostra/mcp

## 0.19.1

### Patch Changes

- Updated dependencies []:
  - @mostra/protocol@0.19.1

## 0.19.0

### Patch Changes

- Updated dependencies [[`837f993`](https://github.com/mostra-dev/mostra/commit/837f99365ce1c2de2c05095841a68d4942116982), [`837f993`](https://github.com/mostra-dev/mostra/commit/837f99365ce1c2de2c05095841a68d4942116982)]:
  - @mostra/protocol@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies []:
  - @mostra/protocol@0.18.0

## 0.17.0

### Minor Changes

- [#185](https://github.com/mostra-dev/mostra/pull/185) [`71369f3`](https://github.com/mostra-dev/mostra/commit/71369f338e2c395c0c58515cc60dc81f4e371a4c) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - MCP Apps export (WP-17, D175): `@mostra/plugin-mcp-app`, Mostra's first first-party plugin, exports a published version as an MCP App, one self-contained `ui://mostra/view/<versionId>` page (`mostra export <artifact> --as mcp-app --out <dir>`), and every home has it. The host protocol gains the app channel: `app/open` opens a view through a link's secret and `app/request` runs the page's browser-protocol routes through the gateway's own checks, so an inline page in a chat host saves answers, submits and runs actions exactly as a browser page does; `app/page` answers a version's MCP App. `@mostra/mcp` adds the app-only tools such a page calls (`app_open`, `app_fields`, `app_submit` and the rest, `_meta.ui.visibility: ["app"]`), the loader page `ui://mostra/app` that `artifact_open` names, and each version's page; `artifact_open` also answers the page's handles as `structuredContent`, and tells the model where the page shows: in the chat, for a client that shows MCP Apps. `@mostra/react`'s `mcp-app` target runs a page inline in an MCP Apps host: it takes the host's look, saves, submits and runs actions through the app-only tools, saves before the host removes it, and shows a small bar with the save state, Submit where the view allows the page's own channel, "Open the full page", and a message for each feature a chat host's frame lacks. `@mostra/themes` maps Mostra's tokens to an MCP Apps host's variables (`HOST_TOKENS`).
  
  An owner instance now keeps a hosted home's submissions in the hosted order when a delivery and a read again of the same answers race ([#139](https://github.com/mostra-dev/mostra/issues/139)): it reads followed submissions again one at a time, in hosted cursor order, holds a delivery that arrives while an earlier submission waits until its turn, tries a failed read again on its own (after 1 s, growing to 60 s), and ends the row of a submission the hosted home refuses for good, so one unreadable answer never holds the rest.
  
  `artifact_verify` answers within a tool call's time ([#157](https://github.com/mostra-dev/mostra/issues/157)): past about 45 seconds it answers `{ status: "running", stage, elapsedSeconds }`, and the same call again joins the run under way, only while the source is the one it started on (a write through the tools, or a changed fingerprint, starts afresh); over the remote MCP server the owner reports verify's stages back (`relay/author.progress`) and fingerprints its workspace (`workspace/fingerprint`).
  
  In cloud chat hosts a hosted home makes each version's MCP App itself, from the version's own client files with the bundled exporter, and keeps it, so the page shown is the published version's and it shows while the owner is offline. `chatHosts` in the server's configuration reads as openly as before: an entry it can't use is logged and left out rather than stopping the server, and a chat host's render (`app` or `link`) is judged once a minute per client. An inline call stops at 45 seconds (`MOSTRA_TARGET_CALL_TOO_LONG`), below a chat host's own limit; a link minted for one person isn't opened inline; and each artifact inline keeps its own unsent answers, though a chat host gives every page one origin.

### Patch Changes

- Updated dependencies [[`71369f3`](https://github.com/mostra-dev/mostra/commit/71369f338e2c395c0c58515cc60dc81f4e371a4c)]:
  - @mostra/protocol@0.17.0

## 0.16.0

### Patch Changes

- Updated dependencies []:
  - @mostra/protocol@0.16.0

## 0.15.2

### Patch Changes

- Updated dependencies []:
  - @mostra/protocol@0.15.2

## 0.15.1

### Patch Changes

- Updated dependencies []:
  - @mostra/protocol@0.15.1

## 0.15.0

### Patch Changes

- Updated dependencies [[`ae3f30a`](https://github.com/mostra-dev/mostra/commit/ae3f30aa73c7e067757a32f550c7fe3232d9cb41)]:
  - @mostra/protocol@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies []:
  - @mostra/protocol@0.14.0

## 0.13.0

### Patch Changes

- Updated dependencies [[`dcafbe0`](https://github.com/mostra-dev/mostra/commit/dcafbe05617a99f0001356d5344cd234dd5acadc)]:
  - @mostra/protocol@0.13.0

## 0.12.0

### Minor Changes

- [#138](https://github.com/mostra-dev/mostra/pull/138) [`74888f3`](https://github.com/mostra-dev/mostra/commit/74888f3aaacac9fe215892c97754a4d2f234fe7c) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Teams (WP-31): expected respondents with personal links (`roster/add`, `roster/remove`, `roster/get`), the waits `submitted:all` and `submitted:<N>` with the durable `roster.completed` event, `results/list` for every submission, `useRespondents()` and `usePresence()` with opt-in cursor and selection sharing that is never stored, attribution of shared fields (who, by key, and when), and the manifest's `team.visibility` (`private` unless the artifact opts in). `mostra roster get|add|remove`, `mostra results --all`, `mostra share --cloud --respondent`, and `artifact_wait`'s team conditions. On a remote server, a hosted artifact's roster lives on its hosted home, `roster.completed` reaches the operator's events, and the operator's `invitations` port hands over each personal link to mail (no mailer ships). The conformance kit adds the scenarios `team.roster` and `team.waits`.

### Patch Changes

- Updated dependencies [[`74888f3`](https://github.com/mostra-dev/mostra/commit/74888f3aaacac9fe215892c97754a4d2f234fe7c), [`3fff053`](https://github.com/mostra-dev/mostra/commit/3fff0532a12871760a3c1ba4d34d0aa95e50c12b)]:
  - @mostra/protocol@0.12.0

## 0.11.0

### Minor Changes

- [#134](https://github.com/mostra-dev/mostra/pull/134) [`2b95dad`](https://github.com/mostra-dev/mostra/commit/2b95dadd20892c3458598b9b1c161dd7237cb5f6) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The remote MCP server (WP-30, MC-04): `mostra-runtime server` serves `@mostra/mcp`'s tools at `<apiOrigin>/mcp` over Streamable HTTP behind its authorization server, for the account a token names. Reading tools act on the account's hosted home; `artifact_create`, `artifact_verify`, `artifact_publish` and the workspace's files are relayed to the account's default owner instance (`port/relay.author`), inside its MCP workspace, and answer `MOSTRA_REMOTE_NO_INSTANCE` while none is connected; a publish answers the hosted link. `@mostra/mcp` gains `createAuthorizedEndpoint` and the bundled reference reader (`fileDocs`, `docsIndex`, `topicMarkdown`), which `mostra docs` now uses too.

### Patch Changes

- Updated dependencies [[`9964a88`](https://github.com/mostra-dev/mostra/commit/9964a881a2a7d57738bbc0691711982f13f0aea1), [`fad4595`](https://github.com/mostra-dev/mostra/commit/fad459525cf1ee74c6fc47960c733f34bc3a81ea), [`91bb507`](https://github.com/mostra-dev/mostra/commit/91bb5079056db241ae5b2fd7cbc743a590c616be), [`312f1c2`](https://github.com/mostra-dev/mostra/commit/312f1c22811cbf53075a215ca71de9cbfcefd6f1), [`2b95dad`](https://github.com/mostra-dev/mostra/commit/2b95dadd20892c3458598b9b1c161dd7237cb5f6)]:
  - @mostra/protocol@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies [[`f0b3cdc`](https://github.com/mostra-dev/mostra/commit/f0b3cdc5156956282d628942419b8d500673c4f6), [`6dbd51b`](https://github.com/mostra-dev/mostra/commit/6dbd51be267212240fd33a4b109ffeb62c503375), [`93c04c1`](https://github.com/mostra-dev/mostra/commit/93c04c1890ebeb56d6abc7bcd2d5f2d139ae3ee5), [`eec2d62`](https://github.com/mostra-dev/mostra/commit/eec2d6251a6e4b3300745cc2565668e51642d9c3), [`e023f3f`](https://github.com/mostra-dev/mostra/commit/e023f3f651765a201400b4b5b09ef35963619100), [`bb061a2`](https://github.com/mostra-dev/mostra/commit/bb061a2a17239d93bfedb13cba3654503da04f4c), [`09ebb64`](https://github.com/mostra-dev/mostra/commit/09ebb643f70362a4170e6e7b03b2ac5848b11d7b), [`622ac47`](https://github.com/mostra-dev/mostra/commit/622ac475f0a58e7508925724ed7e51f4b90fe50c), [`b9e6780`](https://github.com/mostra-dev/mostra/commit/b9e67808da7d67cba596d9f1019ed83aa69acfb0)]:
  - @mostra/protocol@0.10.0

## 0.9.0

### Minor Changes

- [#120](https://github.com/mostra-dev/mostra/pull/120) [`1c414a8`](https://github.com/mostra-dev/mostra/commit/1c414a854fc8c205e24c7220d6da97945b7b820a) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Mostra's MCP server, `@mostra/mcp`: thirteen tools (`artifact_create`, `artifact_write`, `artifact_patch`, `artifact_verify`, `artifact_publish`, `artifact_open`, `artifact_wait`, `artifact_results`, `artifact_list`, `live_push`, `state_get`, `state_patch`, `docs_search`), the reference and artifact reports as resources, and instructions for the loop, independent of the transport. `@mostra/protocol`'s request checks gain the `rpc` intent (a program's JSON-RPC POST with a bearer token) and the diagnostics `MOSTRA_ARTIFACT_PATH_INVALID`, `MOSTRA_ARTIFACT_PATCH_REJECTED`, `MOSTRA_ARTIFACT_ID_DROPPED` (a warning when a write removes the entry's artifact id) and `MOSTRA_ENV_RUNTIME_INSTALLING`.

### Patch Changes

- [#120](https://github.com/mostra-dev/mostra/pull/120) [`0bc9eb3`](https://github.com/mostra-dev/mostra/commit/0bc9eb3ac8d7fb2b91efab06cb5fa4b01ca6edde) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The MCP server's file tools take only names every system can hold, make no folder for a change they refuse, and act on a file only while its folder is still inside the artifact; `MOSTRA_ARTIFACT_ID_DROPPED` also warns when an entry is deleted or renamed in case; a diff's `a/` and `b/` are dropped only in git's form, and a rename never replaces a file. `mostra mcp --http` reads the `Authorization` scheme without regard to case, refuses a `MOSTRA_MCP_TOKEN` with little variety, and prints a generated token only on stderr, with `--json` too. A client that only lists tools is counted in `mcp.session`, over either transport, and calls that meet a daemon restart together share one new session.

- [#120](https://github.com/mostra-dev/mostra/pull/120) [`9b2acf9`](https://github.com/mostra-dev/mostra/commit/9b2acf916a9fd762a62b6c087f560c541e742755) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - On a page whose submission policy is `none`, `results` says it takes no submissions and points at its shared state and signals, and the MCP server's artifact report shows that state; `mostra wait --until signal:<name>` prints the signal's name and payload ([#115](https://github.com/mostra-dev/mostra/issues/115)).
- Updated dependencies [[`1c414a8`](https://github.com/mostra-dev/mostra/commit/1c414a854fc8c205e24c7220d6da97945b7b820a), [`9b2acf9`](https://github.com/mostra-dev/mostra/commit/9b2acf916a9fd762a62b6c087f560c541e742755)]:
  - @mostra/protocol@0.9.0
