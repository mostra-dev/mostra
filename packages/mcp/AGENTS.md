# @mostra/mcp

Mostra's MCP server (INTERFACES §12, D164): the tools, resources and instructions any MCP client
uses to author, verify, publish, wait for and read artifacts, independent of the transport.
Audience: MCP clients, through `mostra mcp` and WP-30's remote server. Runs in: node. May import:
`@mostra/protocol`, `@modelcontextprotocol/server` (the v2 SDK), `zod` and `diff`
(tools/package-map.ts). `@mostra/cli` serves it; this package never imports the CLI or the runtime.

## Invariants it owns

- **The tools know no transport.** `createMcpServerFactory(options)` returns the SDK's factory:
  one `McpServer` per stdio connection or HTTP request, built over three ports (`instance`,
  `workspace`, `docs`, `src/ports.ts`) and holding nothing between calls. Whatever a transport
  needs (a daemon session, a token, telemetry) lives with whoever serves the factory.
- **Every tool takes explicit handles** (a directory, an artifact ID or path, a cursor) and calls
  the instance through the host protocol: no state of the server's own, no logic the protocol
  lacks. A tool needing something the protocol can't do is a protocol gap, fixed there.
- **Results are raw:** the protocol's JSON, Markdown for `artifact_results`, images for the
  screenshots a verdict marks `returned`. A failure is an `isError` result whose text is
  `{ "error": <diagnostic> }`; nothing here is the CLI's envelope.
- **Tool inputs evolve additively** (D32). Each input schema is registered in `toolRegistry` and
  published as `schemas/mcp-tools.*.json`; the `api` job's snapshot check refuses a change that
  isn't additive. Tool names are short and stable, under 64 characters.
- **A tool changes only the files of the artifact it names.** `localWorkspace` checks every path
  before writing anything, walks folders one at a time so nothing is created through a link out of
  the artifact, and applies a change all or nothing: every file is written aside first, then each
  one it replaces or deletes is moved aside and put back if anything later fails (`commit`).
- **HTTP is guarded by the gateway's own checks** (HY-01 item 13, D96): `createHttpEndpoint`
  runs `checkRequest` with the `rpc` intent (exact `Host`, a sane target and headers, no foreign
  `Origin`, a JSON body), then the bearer token in constant time under a guessing limit, before
  the SDK sees the request; every answer carries CORP, `nosniff` and `no-referrer`, and no CORS.
- **No telemetry here.** `onClient` reports the client a server instance serves; only
  `@mostra/cli` may turn that into an event (D119, D140 item 1, D164 item 4).

## Public interface

`src/index.ts`; the API report is `etc/mcp.api.md`; the tool schemas are `schemas/`.

## Tests to run

`pnpm --filter @mostra/mcp test` (the tools through a real SDK client in process, the workspace
and patch rules, the HTTP checks), then `@mostra/cli`'s integration suites, which run `mostra mcp`
over stdio and HTTP against a real daemon. After changing a tool's input, `pnpm --filter
@mostra/mcp gen:schemas`.

## Gotchas

- Tool descriptions, argument descriptions and the instructions are agent-facing prose (D74,
  D149): Mirza accepts them with the package that changes them.
- The SDK builds a server per HTTP request, so `onClient` fires once per request there and once
  per connection on stdio; whoever counts sessions dedupes.
- Relative directories resolve inside the workspace root (`~/mostra-artifacts` by default), never
  the server's working directory, which differs by client (a desktop app has no project folder);
  one that climbs out of it is refused, and an absolute path names any directory.
- `artifact_wait` is capped at 50 s (`WAIT_MAX_SECONDS`) because clients time tool calls out
  (ChatGPT's reported limit is 60 s); the model calls again with the cursor it got.
