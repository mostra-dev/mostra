---
"@mostra/cli": minor
---

`mostra mcp` runs Mostra's MCP server over stdio, or over Streamable HTTP with `--http` (loopback, a bearer token, the gateway's request checks), on the home's daemon. `--workspace` chooses where relative artifact directories and new artifacts go (default `~/mostra-artifacts`), and `--embedded` marks a server a harness plugin or another host starts, which sends no telemetry. The standalone CLI's telemetry counts each MCP client once per run (`mcp.session`). `mostra docs guide/mcp` is the Skill's new reference for working through the tools. Installed from npm, `mostra mcp` answers its client at once and installs its release's runtime bundle in the background on its first start, since clients give a server only seconds to start; a tool that needs the runtime meanwhile answers `MOSTRA_ENV_RUNTIME_INSTALLING` with how far the install is.
