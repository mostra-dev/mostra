/**
 * The MCP server (INTERFACES §12, D164): a factory the SDK calls for each stdio connection or
 * HTTP request, building one `McpServer` with Mostra's tools, resources and instructions over the
 * ports it was given. It holds no state of its own between calls, so the same factory serves
 * stdio, Streamable HTTP and WP-30's remote server.
 */
import { readFile } from "node:fs/promises";
import {
  type CallToolResult,
  CLIENT_INFO_META_KEY,
  McpServer,
  type McpServerFactory,
  ResourceNotFoundError,
  ResourceTemplate,
  type ServerContext,
} from "@modelcontextprotocol/server";
import {
  type ArtifactRef,
  artifactGetMethod,
  artifactListMethod,
  RpcError,
  resultsGetMethod,
  stateGetMethod,
} from "@mostra/protocol";
import type { McpClientInfo, McpServerOptions } from "./ports.ts";
import { diagnosticOf, errorResult } from "./results.ts";
import { docsUri } from "./search.ts";
import { createTools, type ToolCall } from "./tools.ts";

/** The name the server gives in `serverInfo`. */
export const SERVER_NAME = "mostra";

/** The topics `resources/list` names: the guide and the pages, not every diagnostic code. */
function listedTopic(topic: string): boolean {
  return !topic.startsWith("MOSTRA_");
}

/** The instructions a client gives its model with the tools (D164 item 6). */
export function serverInstructions(workspaceRoot: string): string {
  return [
    "Mostra turns a React page you write into an artifact: a page a person opens from a private link, reads, answers and acts on. Their answers are saved as they type and come back to you as results. Use it whenever showing or asking works better as a page than as chat text: questions, a choice between options, a plan to approve, work to review, a report, a dashboard.",
    "",
    "The loop; each step is done when its check holds:",
    "1. artifact_create. Keep the directory it returns.",
    '2. Write index.tsx with artifact_write, keeping the id line of its defineArtifact: ordinary React 19, TypeScript and Tailwind CSS 4, no package.json. Every answer is a field with a stable ID: useField("budget", 0, { label: "Budget" }). Read the guide first: docs_search with topic "guide".',
    "3. artifact_verify until its status is pass, then look at the screenshots (screenshots: always).",
    "4. artifact_publish.",
    "5. artifact_open for the link. Give it to the person with what it's for and who is asking.",
    "6. artifact_wait with until: submitted. While it returns still_waiting, call it again with after set to its cursor.",
    "7. artifact_results, then act on every answer.",
    "",
    `Relative directories are inside the workspace folder, ${workspaceRoot}.`,
  ].join("\n");
}

/** The client a request comes from: the 2026-07-28 envelope's `clientInfo`, or the session's. */
function clientOf(server: McpServer, ctx: ServerContext): McpClientInfo | undefined {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const info = (envelope?.[CLIENT_INFO_META_KEY] ?? server.server.getClientVersion()) as
    | { name?: unknown; version?: unknown }
    | undefined;
  if (typeof info?.name !== "string") return undefined;
  return {
    name: info.name,
    ...(typeof info.version === "string" ? { version: info.version } : {}),
  };
}

/** Markdown for an artifact's report resource: what it is, its versions, its latest answers. */
async function artifactReport(options: McpServerOptions, artifact: ArtifactRef): Promise<string> {
  const detail = await options.instance.call(artifactGetMethod, { artifact });
  const lines = [
    `# ${detail.title}`,
    "",
    `- ID: ${detail.id}`,
    ...(detail.description !== undefined ? [`- Description: ${detail.description}`] : []),
    ...(detail.family !== undefined ? [`- Family: ${detail.family}`] : []),
    ...(detail.source !== undefined ? [`- Source: ${detail.source}`] : []),
    ...(detail.policy !== undefined
      ? [`- Submission policy: ${JSON.stringify(detail.policy)}`]
      : []),
    "",
    "## Versions",
    "",
    ...(detail.versions.length === 0
      ? ["(none)"]
      : detail.versions
          .slice(0, 20)
          .map((version) => `- ${version.number}: ${version.id}, ${version.publishedAt}`)),
    "",
  ];
  // A page whose policy is `none` takes no submissions: its viewers' work is its shared state
  // (D63, #115), which the report shows first. A submission made under an earlier policy still
  // shows below.
  const none = detail.policy?.policy === "none";
  if (none) {
    const state = await options.instance.call(stateGetMethod, { artifact });
    const json = JSON.stringify(state.fields, null, 2);
    // A fence longer than any run of backticks in the values, as results' Markdown does (D101).
    const fence = "`".repeat(Math.max(3, ...[...json.matchAll(/`+/g)].map((m) => m[0].length + 1)));
    lines.push(
      "## Shared state",
      "",
      `This artifact takes no submissions (its policy is none). Its shared state, at revision ${state.revision}:`,
      "",
      `${fence}json`,
      json,
      fence,
      "",
      "Wait for its signals with artifact_wait (until: signal:<name>); each event carries the payload the page sent.",
      "",
    );
  }
  lines.push("## Latest submission", "");
  try {
    const results = await options.instance.call(resultsGetMethod, { artifact, format: "md" });
    lines.push("markdown" in results ? results.markdown : JSON.stringify(results));
  } catch (error) {
    if (error instanceof RpcError && error.diagnostic.code === "MOSTRA_SUBMIT_NOT_FOUND") {
      lines.push(none ? "(none: it takes no submissions)" : "(none yet)");
    } else throw error;
  }
  return lines.join("\n");
}

/** Builds the factory every transport serves. */
export function createMcpServerFactory(options: McpServerOptions): McpServerFactory {
  const tools = createTools(
    options.readScreenshot ?? (async (path) => new Uint8Array(await readFile(path))),
  );
  const instructions = serverInstructions(options.workspace.root);
  return () => {
    const server = new McpServer(
      { name: SERVER_NAME, title: "Mostra", version: options.version },
      { instructions },
    );
    let told = false;
    const seen = (ctx: ServerContext): void => {
      if (told || options.onClient === undefined) return;
      const client = clientOf(server, ctx);
      if (client === undefined) return;
      told = true;
      try {
        options.onClient(client);
      } catch {
        // Counting a session never fails a tool.
      }
    };

    for (const tool of tools) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.input as never,
          annotations: tool.annotations,
        },
        (async (args: unknown, ctx: ServerContext): Promise<CallToolResult> => {
          seen(ctx);
          const progressToken = ctx.mcpReq._meta?.progressToken;
          let step = 0;
          const call: ToolCall = {
            options,
            progress(message) {
              if (progressToken === undefined) return;
              step += 1;
              void ctx.mcpReq
                .notify({
                  method: "notifications/progress",
                  params: { progressToken, progress: step, message },
                })
                .catch(() => {});
            },
          };
          try {
            return await tool.run(args, call);
          } catch (error) {
            return errorResult(diagnosticOf(error));
          }
        }) as never,
      );
    }

    server.registerResource(
      "docs",
      new ResourceTemplate("mostra://docs/{+topic}", {
        list: async () => ({
          resources: options.docs
            .topics()
            .filter((topic) => listedTopic(topic.topic))
            .map((topic) => ({
              uri: docsUri(topic.topic),
              name: topic.topic,
              title: topic.title,
              mimeType: "text/markdown",
            })),
        }),
      }),
      {
        title: "Mostra's reference",
        description:
          "Mostra's bundled reference by topic: guide (writing pages) and guide/<name>, cli, telemetry, and each diagnostic code.",
        mimeType: "text/markdown",
      },
      async (uri, variables, ctx) => {
        seen(ctx);
        const topic = String(variables["topic"] ?? "");
        const markdown = options.docs.read(topic);
        if (markdown === undefined) throw new ResourceNotFoundError(uri.href);
        return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: markdown }] };
      },
    );

    server.registerResource(
      "artifact-report",
      new ResourceTemplate("mostra://artifacts/{id}/report", {
        list: async () => {
          const { artifacts } = await options.instance.call(artifactListMethod, {});
          return {
            resources: artifacts.map((artifact) => ({
              uri: `mostra://artifacts/${artifact.id}/report`,
              name: artifact.id,
              title: artifact.title,
              mimeType: "text/markdown",
            })),
          };
        },
      }),
      {
        title: "Artifact report",
        description:
          "An artifact's summary: what it is, its versions and its latest submission's results.",
        mimeType: "text/markdown",
      },
      async (uri, variables, ctx) => {
        seen(ctx);
        const id = String(variables["id"] ?? "");
        try {
          const text = await artifactReport(options, { artifactId: id });
          return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
        } catch (error) {
          if (error instanceof RpcError && error.diagnostic.code === "MOSTRA_ARTIFACT_NOT_FOUND") {
            throw new ResourceNotFoundError(uri.href);
          }
          throw error;
        }
      },
    );
    return server;
  };
}
