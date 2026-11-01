# @mostra/mcp

Mostra's MCP server: the tools, resources and instructions an MCP client uses to create, write,
verify and publish an artifact, hand a person its link, wait for their answer and read the
results. Most people run it as `mostra mcp` (stdio, or Streamable HTTP with `--http`); this
package is for serving the same tools from your own process.

```ts
import { createMcpServerFactory, localWorkspace, defaultWorkspaceRoot } from "@mostra/mcp";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

const factory = createMcpServerFactory({
  instance,                                        // calls the host protocol (e.g. through @mostra/sdk)
  workspace: localWorkspace(defaultWorkspaceRoot()),
  docs,                                            // Mostra's reference by topic
  version: "0.9.0",
});
serveStdio(factory);
```

The tools: `artifact_create`, `artifact_write`, `artifact_patch`, `artifact_verify`,
`artifact_publish`, `artifact_open`, `artifact_wait` (at most 50 s, then `still_waiting` with a
cursor), `artifact_results`, `artifact_list`, `live_push`, `state_get`, `state_patch` and
`docs_search`. The resources: `mostra://docs/{topic}` and `mostra://artifacts/{id}/report`.
`createHttpEndpoint(factory, { origin, hosts, token })` serves the factory over Streamable HTTP
behind exact `Host` and `Origin` checks and a bearer token.

Part of [Mostra](https://github.com/mostra-dev/mostra), the agent artifact runtime. Apache-2.0.
