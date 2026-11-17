---
"@mostra/mcp": minor
"@mostra/plugin-mcp-app": minor
"@mostra/protocol": minor
"@mostra/react": minor
"@mostra/runtime": minor
"@mostra/themes": minor
---

MCP Apps export (WP-17, D175): `@mostra/plugin-mcp-app`, Mostra's first first-party plugin, exports a published version as an MCP App, one self-contained `ui://mostra/view/<versionId>` page (`mostra export <artifact> --as mcp-app --out <dir>`), and every home has it. The host protocol gains the app channel: `app/open` opens a view through a link's secret and `app/request` runs the page's browser-protocol routes through the gateway's own checks, so an inline page in a chat host saves answers, submits and runs actions exactly as a browser page does; `app/page` answers a version's MCP App. `@mostra/mcp` adds the app-only tools such a page calls (`app_open`, `app_fields`, `app_submit` and the rest, `_meta.ui.visibility: ["app"]`), the loader page `ui://mostra/app` that `artifact_open` names, and each version's page; `artifact_open` also answers the page's handles as `structuredContent`. `@mostra/react`'s `mcp-app` target runs a page inline in an MCP Apps host: it takes the host's look, saves, submits and runs actions through the app-only tools, saves before the host removes it, and shows a small bar with the save state, Submit where the view allows the page's own channel, "Open the full page", and a message for each feature a chat host's frame lacks. `@mostra/themes` maps Mostra's tokens to an MCP Apps host's variables (`HOST_TOKENS`).
