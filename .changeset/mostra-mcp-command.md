---
"@mostra/cli": minor
---

`mostra mcp` runs Mostra's MCP server over stdio, or over Streamable HTTP with `--http` (loopback, a bearer token, the gateway's request checks), on the home's daemon. `--workspace` chooses where relative artifact directories and new artifacts go (default `~/mostra-artifacts`), and `--embedded` marks a server a harness plugin or another host starts, which sends no telemetry. The standalone CLI's telemetry counts each MCP client once per run (`mcp.session`). `mostra docs guide/mcp` is the Skill's new reference for working through the tools.
