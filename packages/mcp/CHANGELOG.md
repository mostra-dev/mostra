# @mostra/mcp

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
