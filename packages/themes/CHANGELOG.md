# @mostra/themes

## 0.21.0

No changes in this release.

## 0.20.0

### Minor Changes

- [#244](https://github.com/mostra-dev/mostra/pull/244) [`bd0834e`](https://github.com/mostra-dev/mostra/commit/bd0834e6c8ee9a1a0930c57d458733e5c2662c11) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A server's own pages show Mostra's wordmark at the top where the server calls itself Mostra (its default), and an operator's own name set in the display face as a mark; the consent page says "An app calling itself …" before a name nobody checked, in place of a parenthesis after it.

## 0.19.1

No changes in this release.

## 0.19.0

### Minor Changes

- [#215](https://github.com/mostra-dev/mostra/pull/215) [`837f993`](https://github.com/mostra-dev/mostra/commit/837f99365ce1c2de2c05095841a68d4942116982) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - The kit (WP-18, D181). `@mostra/kit` is new: shadcn 4.23.0's components for both bases (Base UI, the default, and Radix with `kit: { base: "radix" }`), restyled onto the themes' tokens, which `@/components/ui/<name>` imports with nothing installed and `mostra add <name>` copies for editing; `@mostra/kit/layout` (`Page`, `Section`, `Figures`, `Figure`); and `@mostra/kit/questionnaire`, whose every answer is a field. Every page wears a theme stack (`kit: { theme: "studio" | "arcata" | [...] }`): `@mostra/themes` ships Studio, now an editorial look, and Arcata, the brand's flat, round other half, both in light and dark, plus `frame`, UX-01's look, which the shell and a server's pages keep. A stack takes plugins' themes, the artifact's own CSS layers and `"host"`, and a theme is data with a JSON schema (`theme.schema.json`). A theme layer's faces, name and CSS are checked as CSS takes them, so a plugin's theme can add no rule and load nothing; `@/` keeps its query (`?raw`, `?url`) and works in stylesheets too.

## 0.18.0

### Minor Changes

- [#208](https://github.com/mostra-dev/mostra/pull/208) [`7bfa75a`](https://github.com/mostra-dev/mostra/commit/7bfa75ac39f3339179308d2938b49dc190471b39) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Signing out of a remote server, and the operator's metering window (all additive within `OPERATOR_REVISION` `2026-11-08`):
  
  - **A person can sign out of the server's sign-in.** Every page of the API origin that shows who is signed in (the sign-in page, linking a machine, a chat app's consent, "Answer as yourself") says "Signed in as Ada · Sign out", and its button ends that browser's sign-in: its session and its cookie go, so the next sign-in in that browser goes through the provider again. `POST /signout` takes the sign-out only from the API origin's own pages or from an operator's own app (an `operatorClients` client, by its pages' exact `Origin`), never from another origin and never by a `GET`; `GET /signout` is a page with one button.
  - **An operator's own app signs a person out of both with one "Sign out".** Its form posts to `POST /signout` with OpenID Connect RP-Initiated Logout's `client_id`, `post_logout_redirect_uri` and `state`; the person goes back only to an address listed in the app's metadata document's `post_logout_redirect_uris`. Dynamic Client Registration takes `post_logout_redirect_uris` too. The server's metadata names the sign-out as `end_session_endpoint`.
  - **`prompt=login` and `prompt=consent`** on `/oauth/authorize`: a fresh sign-in through the provider whatever the browser's session, and consent asked again; any other `prompt` value is refused with `invalid_request`. The metadata advertises `prompt_values_supported`.
  - **A hosted page's viewer chip signs the page out**, and with one more button on the server's "Sign out?" page, the browser's sign-in there too: the page answers as anyone with the link again in that browser, the account's frame sessions end at once, the next "Sign in" asks for a provider again, and drafts and answers stay with whoever made them.
  - **Expired sign-ins are swept** hourly: browser sessions, sign-ins never finished, spent codes and expired tokens.
  - **`metering.windowSeconds`** in the server's configuration sets how long an operator's metering windows last (whole minutes that divide an hour, 60 seconds by default). Windows now start on multiples of their length, so none straddles an hour, and a longer window means fewer writes of the server's directory.
  - `@mostra/themes` gains `signedInLine`, a "Signed in as … · Sign out" line for a server's pages, and `localPath`, which `safeHref` now uses: a path with a tab, a newline, another control character or a backslash, which a browser could read as another origin, is no path of the page's own any more.

## 0.17.0

### Minor Changes

- [#185](https://github.com/mostra-dev/mostra/pull/185) [`71369f3`](https://github.com/mostra-dev/mostra/commit/71369f338e2c395c0c58515cc60dc81f4e371a4c) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - MCP Apps export (WP-17, D175): `@mostra/plugin-mcp-app`, Mostra's first first-party plugin, exports a published version as an MCP App, one self-contained `ui://mostra/view/<versionId>` page (`mostra export <artifact> --as mcp-app --out <dir>`), and every home has it. The host protocol gains the app channel: `app/open` opens a view through a link's secret and `app/request` runs the page's browser-protocol routes through the gateway's own checks, so an inline page in a chat host saves answers, submits and runs actions exactly as a browser page does; `app/page` answers a version's MCP App. `@mostra/mcp` adds the app-only tools such a page calls (`app_open`, `app_fields`, `app_submit` and the rest, `_meta.ui.visibility: ["app"]`), the loader page `ui://mostra/app` that `artifact_open` names, and each version's page; `artifact_open` also answers the page's handles as `structuredContent`, and tells the model where the page shows: in the chat, for a client that shows MCP Apps. `@mostra/react`'s `mcp-app` target runs a page inline in an MCP Apps host: it takes the host's look, saves, submits and runs actions through the app-only tools, saves before the host removes it, and shows a small bar with the save state, Submit where the view allows the page's own channel, "Open the full page", and a message for each feature a chat host's frame lacks. `@mostra/themes` maps Mostra's tokens to an MCP Apps host's variables (`HOST_TOKENS`).
  
  An owner instance now keeps a hosted home's submissions in the hosted order when a delivery and a read again of the same answers race ([#139](https://github.com/mostra-dev/mostra/issues/139)): it reads followed submissions again one at a time, in hosted cursor order, holds a delivery that arrives while an earlier submission waits until its turn, tries a failed read again on its own (after 1 s, growing to 60 s), and ends the row of a submission the hosted home refuses for good, so one unreadable answer never holds the rest.
  
  `artifact_verify` answers within a tool call's time ([#157](https://github.com/mostra-dev/mostra/issues/157)): past about 45 seconds it answers `{ status: "running", stage, elapsedSeconds }`, and the same call again joins the run under way, only while the source is the one it started on (a write through the tools, or a changed fingerprint, starts afresh); over the remote MCP server the owner reports verify's stages back (`relay/author.progress`) and fingerprints its workspace (`workspace/fingerprint`).
  
  In cloud chat hosts a hosted home makes each version's MCP App itself, from the version's own client files with the bundled exporter, and keeps it, so the page shown is the published version's and it shows while the owner is offline. `chatHosts` in the server's configuration reads as openly as before: an entry it can't use is logged and left out rather than stopping the server, and a chat host's render (`app` or `link`) is judged once a minute per client. An inline call stops at 45 seconds (`MOSTRA_TARGET_CALL_TOO_LONG`), below a chat host's own limit; a link minted for one person isn't opened inline; and each artifact inline keeps its own unsent answers, though a chat host gives every page one origin.

## 0.16.0

No changes in this release.

## 0.15.2

No changes in this release.

## 0.15.1

No changes in this release.

## 0.15.0

No changes in this release.

## 0.14.0

### Minor Changes

- [#150](https://github.com/mostra-dev/mostra/pull/150) [`662f879`](https://github.com/mostra-dev/mostra/commit/662f8798d719446b15f583c3b285ce0fec097b89) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - Artifacts have Studio's own type: `@mostra/themes` is in the warm set and ships `css/faces.css` (Figtree, Jost and Spline Sans Mono, SIL OFL 1.1), which the Skill's Studio stylesheet imports, so an artifact's build bundles the faces with no install and no third-party request.

- [#150](https://github.com/mostra-dev/mostra/pull/150) [`c909aa3`](https://github.com/mostra-dev/mostra/commit/c909aa323c6db9863e2797807ee792a474e0ee31) Thanks [@dev-mirzabicer](https://github.com/dev-mirzabicer)! - A new package, `@mostra/themes`: Mostra's themes as data (`studio` and `mostra`, light and dark, checked for WCAG 2.2 AA by `defineTheme`), their stylesheets (`@mostra/themes/css/studio.css`, `css/mostra.css`) and self-hosted faces (Figtree, Jost, Spline Sans Mono), a template for the pages a server draws itself with no script (`createPages`), and one for mail (`renderMail`).
