/**
 * Mostra's MCP server (INTERFACES §12, D164): the tools, resources and instructions any MCP
 * client uses to author, verify, publish, wait for and read Mostra artifacts, independent of the
 * transport. `mostra mcp` serves them over stdio and Streamable HTTP; a remote server serves the
 * same factory with its own ports.
 *
 * ```ts
 * const factory = createMcpServerFactory({ instance, workspace: localWorkspace(root), docs, version });
 * serveStdio(factory);                                   // @modelcontextprotocol/server/stdio
 * const endpoint = createHttpEndpoint(factory, { origin, hosts, token });
 * ```
 *
 * @packageDocumentation
 */

export {
  type DocsTopic,
  docsIndex,
  fileDocs,
  GUIDE_LINKS,
  guideTopics,
  indexMarkdown,
  MCP_GUIDE_LINKS,
  nearestTopics,
  topicMarkdown,
} from "./docs.ts";
export {
  createAuthorizedEndpoint,
  createHttpEndpoint,
  GUESS_LIMIT,
  GUESS_WINDOW_MS,
  type HttpEndpointPolicy,
  MCP_MAX_BODY_BYTES,
  MCP_PATH,
  type McpAuthorization,
  type McpAuthorizedEndpoint,
  type McpHttpEndpoint,
  type RawRequest,
} from "./http.ts";
export {
  type PatchRejection,
  type PatchRequest,
  type PlannedPatch,
  planPatch,
  type ReadFile,
  type TextEdit,
} from "./patch.ts";
export type {
  DocsTopicSummary,
  McpBrowser,
  McpClientInfo,
  McpDocs,
  McpInstance,
  McpServerOptions,
  McpWorkspace,
  WorkspaceFile,
} from "./ports.ts";
export { type DocsHit, docsUri, searchDocs } from "./search.ts";
export { createMcpServerFactory, SERVER_NAME, serverInstructions } from "./server.ts";
export {
  createTools,
  type ToolCall,
  type ToolDefinition,
  toolRegistry,
  WAIT_MAX_SECONDS,
} from "./tools.ts";
export { artifactPath, defaultWorkspaceRoot, localWorkspace, slug } from "./workspace.ts";
