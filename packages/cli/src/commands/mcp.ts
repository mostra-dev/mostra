/**
 * `mostra mcp` (INTERFACES §12, D164): Mostra's MCP server, for any MCP client. Over stdio by
 * default (a client starts it), or Streamable HTTP with `--http`. Its tools are `@mostra/mcp`'s;
 * this command gives them the home's daemon, the workspace and the reference, and counts each
 * MCP client in telemetry unless `--embedded` says a host or harness plugin started it (D148).
 */
import { resolve } from "node:path";
import type { McpClientInfo } from "@mostra/mcp";
import { defaultWorkspaceRoot } from "@mostra/mcp";
import { type CommandDef, defineCommand } from "../command.ts";
import { embeddedHome, readHomeMarks } from "../home.ts";
import { type DaemonInstance, serveOverHttp, serveOverStdio } from "../mcp.ts";
import { usage } from "../parse.ts";
import { mcpSessionFields } from "../telemetry/harness.ts";
import { cliVersion } from "../version.ts";
import { flag } from "./shared.ts";

/** `mostra mcp`. */
export const mcpCommand: CommandDef = defineCommand({
  path: ["mcp"],
  summary:
    "Run Mostra's MCP server, so an MCP client can create, verify and publish artifacts, wait for answers and read results.",
  flags: [
    {
      name: "http",
      kind: "boolean",
      summary:
        "Serve Streamable HTTP at /mcp instead of stdio; every request needs Authorization: Bearer <token>.",
    },
    {
      name: "port",
      kind: "number",
      value: "<port>",
      summary: "With --http, the port; default one the system picks.",
    },
    {
      name: "bind",
      kind: "string",
      value: "<address>",
      summary: "With --http, listen on this address instead of 127.0.0.1.",
    },
    {
      name: "url-host",
      kind: "string",
      value: "<name>",
      summary: "With --http, the host name clients use; a wildcard --bind needs it.",
    },
    {
      name: "workspace",
      kind: "string",
      value: "<dir>",
      summary:
        "Where relative artifact directories and new artifacts go. Default: MOSTRA_MCP_WORKSPACE, else ~/mostra-artifacts.",
    },
    {
      name: "embedded",
      kind: "boolean",
      summary:
        "This server runs on someone's behalf (a harness plugin or another host started it), so it sends no telemetry.",
    },
  ],
  output: { type: "the MCP protocol on stdin and stdout, or over HTTP", topic: "cli" },
  exits: [],
  example: "mcp",
  readsStdin: (flags) => flags["http"] !== true,
  quiet: (flags) => flags["embedded"] === true,
  async run(context) {
    const http = context.flags["http"] === true;
    const port = context.flags["port"];
    const bind = flag(context, "bind");
    const urlHost = flag(context, "url-host");
    if (!http && (port !== undefined || bind !== undefined || urlHost !== undefined)) {
      throw usage("--port, --bind and --url-host go with --http.");
    }
    if (typeof port === "number" && (!Number.isInteger(port) || port < 0 || port > 65_535)) {
      throw usage("--port takes a port number from 0 to 65535.");
    }
    const given = flag(context, "workspace") ?? context.env["MOSTRA_MCP_WORKSPACE"];
    const workspace =
      given !== undefined && given !== "" ? resolve(context.cwd, given) : defaultWorkspaceRoot();
    const counted = new Set<string>();
    let reached: DaemonInstance | undefined;
    const options = {
      home: context.home,
      env: context.env,
      workspace,
      version: cliVersion(),
      log: context.log,
      onClient(client: McpClientInfo, instance: DaemonInstance) {
        // Each client once per process (D140 item 8), and queued at once, since a harness stops
        // its server within a second, before any end of the command (D164 item 4). Connecting
        // starts nothing: a host-spawned instance always marks its home (D140 item 4), which
        // the mark read now tells, as does a session a call already opened.
        reached = instance;
        const fields = mcpSessionFields(client);
        const key = `${fields.client}@${fields.clientVersion ?? ""}`;
        if (counted.has(key)) return;
        counted.add(key);
        context.record({ event: "mcp.session", fields });
        context.checkpoint(instance.hostInstance() || embeddedHome(readHomeMarks(context.home)));
      },
    };
    const done = { result: undefined, raw: true as const };
    if (!http) {
      await serveOverStdio(options);
      return { ...done, hostInstance: reached?.hostInstance() === true };
    }
    await serveOverHttp({
      ...options,
      port: typeof port === "number" ? port : 0,
      ...(bind !== undefined ? { bind } : {}),
      ...(urlHost !== undefined ? { urlHost } : {}),
      onListening({ url, token, generated }) {
        // The token is a secret: it goes to stderr once, never to stdout, which a supervisor
        // may keep in a log (D164 item 3, Opus review of WP-15, finding 8). A program that needs
        // the token sets MOSTRA_MCP_TOKEN; `listening` gives it the URL.
        if (context.json) context.emit({ kind: "listening", url });
        else context.stderr(`Mostra's MCP server is listening at ${url}\n`);
        context.stderr(
          generated
            ? `Send Authorization: Bearer ${token} with every request (set MOSTRA_MCP_TOKEN to choose the token).\n`
            : "Send Authorization: Bearer <MOSTRA_MCP_TOKEN> with every request.\n",
        );
      },
    });
    return { ...done, hostInstance: reached?.hostInstance() === true };
  },
});
