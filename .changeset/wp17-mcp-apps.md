---
"@mostra/plugin-mcp-app": minor
"@mostra/protocol": minor
"@mostra/runtime": minor
"@mostra/themes": minor
---

MCP Apps export (WP-17, D175): `@mostra/plugin-mcp-app`, Mostra's first first-party plugin, exports a published version as an MCP App, one self-contained `ui://mostra/view/<versionId>` page (`mostra export <artifact> --as mcp-app --out <dir>`). The host protocol gains the app channel: `app/open` opens a view through a link's secret and `app/request` runs the page's browser-protocol routes through the gateway's own checks, so an inline page in a chat host saves answers, submits and runs actions exactly as a browser page does. `@mostra/themes` maps Mostra's tokens to an MCP Apps host's variables (`HOST_TOKENS`).
