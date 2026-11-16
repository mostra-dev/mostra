# @mostra/plugin-mcp-app

Mostra's MCP App exporter (D175 items 2 and 3, MC-02, INTERFACES §12 and §15): the first first-party plugin, on `@mostra/contract-exporter`. It turns one published version into an MCP App, one self-contained HTML5 page (`index.html`, `text/html;profile=mcp-app`) that chat hosts show inline as `ui://mostra/view/<versionId>`, and `mcp-app.json`, that resource's description with the origins it declares. Audience: every home (it is bundled), and anyone exporting an MCP App. Runs in: a plugin child of the instance, never the supervisor (RT-02).

## Invariants it owns

- **One document, nothing else.** The page holds the whole client build: one module script (the build's chunks and dynamic imports joined by Rolldown), every stylesheet inline, every file the build names by path as a `data:` URL. It loads nothing from anywhere, so a host's default policy shows it.
- **It never reads outside the version.** Every module comes from the exporter's file tree; an import of anything else (a bare specifier, a URL) fails the export. It never sees `server/`.
- **Its own origins only.** It declares the `https:` origins the artifact's own sources name (from the build's source maps, never a package's documentation links) and those its stylesheets load, plus the options' own.
- **Nothing ends its elements early.** Script text has the `<` of `</script`, `<script` and `<!--` written `\x3C`; stylesheet text has `</style` written `<\/style`.
- **The target marker** `<meta name="mostra-target" content="mcp-app">` beside `mostra-version`, so the page routes in memory and talks to its host through the app-only tools (D111).

## Public interface

`src/index.ts` (the default export is the exporter); the manifest is the `"mostra"` key of `package.json`; the API report is `etc/plugin-mcp-app.api.md`.

## Tests to run

`pnpm --filter @mostra/plugin-mcp-app test`; the runtime's `extensions` group (`mcp-apps.test.ts`) and the `mcp-app` end-to-end specs run it through `plugin/export` and in a real browser; then `pnpm check --affected`.

## Gotchas

- Rolldown is pinned to the version Vite pins (the catalog), so the runtime bundle carries one native binary.
- Font files are left out: a chat host's policy has no `font-src`, and the host's faces take the page's (D141 item 4).
- Its version moves with the release's fixed group, and the runtime bundle carries it (scope `bundled`, D175 item 3).
