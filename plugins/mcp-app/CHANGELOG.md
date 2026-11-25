# @mostra/plugin-mcp-app

## 0.20.0

### Patch Changes

- Updated dependencies [[`4540c0c`](https://github.com/mostra-dev/mostra/commit/4540c0c335822da6e1cb757db1e1e7bdc9a29b23), [`c06fa31`](https://github.com/mostra-dev/mostra/commit/c06fa31bed473eddc348b3cc0bc638c0f7a1ff47), [`b4d39b0`](https://github.com/mostra-dev/mostra/commit/b4d39b033760a8b80ee615f0d46b04ad09d61ee9), [`3c8737c`](https://github.com/mostra-dev/mostra/commit/3c8737c3ff4ac1ed846ce2ca146b91afc5ea7ce0), [`8720320`](https://github.com/mostra-dev/mostra/commit/87203205993c53e10f5d61167751d6725b2bc849), [`bd0834e`](https://github.com/mostra-dev/mostra/commit/bd0834e6c8ee9a1a0930c57d458733e5c2662c11)]:
  - @mostra/protocol@0.20.0
  - @mostra/themes@0.20.0

## 0.19.1

### Patch Changes

- Updated dependencies []:
  - @mostra/protocol@0.19.1
  - @mostra/themes@0.19.1

## 0.19.0

### Patch Changes

- [#215](https://github.com/mostra-dev/mostra/pull/215) [`837f993`](https://github.com/mostra-dev/mostra/commit/837f99365ce1c2de2c05095841a68d4942116982) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A field may name its options (`useField(id, initial, { options: [{ value, label, recommended }] })`), and results name each answer by the label the viewer saw and say whether they took the recommended one (WP-18). The shell tells a page the person's light or dark, and a host's look (`HomeConfig.look`) reaches only a page whose stack names `"host"`, in the shell and inline in an MCP Apps host alike; the MCP App exporter keeps the page's theme. A field's options count toward its draft's 16 MiB and take at most 64 KiB (`FIELD_OPTIONS_MAX_BYTES`); a page with more saves the answer without them and says so on its console.
- Updated dependencies [[`837f993`](https://github.com/mostra-dev/mostra/commit/837f99365ce1c2de2c05095841a68d4942116982), [`837f993`](https://github.com/mostra-dev/mostra/commit/837f99365ce1c2de2c05095841a68d4942116982), [`837f993`](https://github.com/mostra-dev/mostra/commit/837f99365ce1c2de2c05095841a68d4942116982)]:
  - @mostra/protocol@0.19.0
  - @mostra/themes@0.19.0

## 0.18.0

### Patch Changes

- Updated dependencies [[`7bfa75a`](https://github.com/mostra-dev/mostra/commit/7bfa75ac39f3339179308d2938b49dc190471b39)]:
  - @mostra/themes@0.18.0
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
  - @mostra/themes@0.17.0
