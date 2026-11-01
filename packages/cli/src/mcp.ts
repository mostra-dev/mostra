/**
 * `mostra mcp` (INTERFACES §12, D164): serves `@mostra/mcp`'s tools over stdio, or over
 * Streamable HTTP with `--http`, on the home's daemon. Everything the tools need from this
 * computer is here: the session with the daemon (opened on the first call, opened again after the
 * daemon restarts, released after five idle minutes so a server a harness keeps open for a week
 * doesn't keep the daemon from its idle exit), the workspace of artifacts' files, the bundled
 * reference and the browser opener.
 */
import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { serve } from "@hono/node-server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
  createHttpEndpoint,
  createMcpServerFactory,
  type DocsTopicSummary,
  localWorkspace,
  MCP_PATH,
  type McpClientInfo,
  type McpDocs,
  type McpInstance,
} from "@mostra/mcp";
import {
  ARTIFACT_PROGRESS,
  type ArtifactProgressParams,
  createDiagnostic,
  type MethodDefinition,
  RpcError,
} from "@mostra/protocol";
import { openInBrowser } from "./browser.ts";
import { connect, type InstanceConnection } from "./client.ts";
import { docsIndex, MCP_GUIDE_LINKS, skillDir, topicMarkdown } from "./docs.ts";
import type { Environment } from "./home.ts";

/** How long the session with the daemon stays open after the last call. */
export const MCP_IDLE_MS: number = 5 * 60_000;

/** The instance port over the home's daemon, as the CLI reaches it. */
export interface DaemonInstance extends McpInstance {
  /** Whether the instance reached is a host-spawned one (then telemetry sends nothing). */
  hostInstance(): boolean;
  /** Opens the session (starting the daemon when none runs), so {@link hostInstance} is known. */
  ensure(): Promise<void>;
  /** Ends the session. */
  close(): void;
}

/** The home's daemon as the MCP server's instance (D164 item 5). */
export function daemonInstance(options: {
  readonly home: string;
  readonly env: Environment;
  readonly log: (line: string) => void;
  readonly idleMs?: number;
}): DaemonInstance {
  const idleMs = options.idleMs ?? MCP_IDLE_MS;
  const listeners = new Map<string, (progress: ArtifactProgressParams) => void>();
  let session: Promise<InstanceConnection> | undefined;
  let host = false;
  let inflight = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;

  const open = (): Promise<InstanceConnection> => {
    if (session !== undefined) return session;
    const opening = connect({ home: options.home, env: options.env }).then((connection) => {
      if (connection === undefined) {
        throw new RpcError(
          createDiagnostic("MOSTRA_HOST_CONNECTION_CLOSED", {
            message: "No instance runs for this home.",
          }),
        );
      }
      host = connection.summary.mode === "host";
      for (const warning of connection.warnings)
        options.log(`mostra mcp: ${warning.code}: ${warning.message}`);
      connection.onNotification(ARTIFACT_PROGRESS, (params) => {
        const progress = params as ArtifactProgressParams;
        listeners.get(progress.progressToken)?.(progress);
      });
      void connection.closed.then(() => {
        if (session === opening) session = undefined;
      });
      return connection;
    });
    session = opening;
    opening.catch(() => {
      if (session === opening) session = undefined;
    });
    return opening;
  };

  const release = (): void => {
    const current = session;
    session = undefined;
    void current?.then((connection) => connection.close()).catch(() => {});
  };

  const settle = (): void => {
    inflight -= 1;
    if (inflight > 0) return;
    clearTimeout(idle);
    idle = setTimeout(release, idleMs);
    idle.unref();
  };

  return {
    async call<P, R>(method: MethodDefinition<P, R>, params: P): Promise<R> {
      inflight += 1;
      clearTimeout(idle);
      try {
        try {
          return await (await open()).call(method, params);
        } catch (error) {
          // A daemon that restarted or went idle closed the session: a method that changes
          // nothing is asked again on a new one; a change is never sent twice.
          const closed =
            error instanceof RpcError && error.diagnostic.code === "MOSTRA_HOST_CONNECTION_CLOSED";
          if (!closed || method.mutating) throw error;
          session = undefined;
          return await (await open()).call(method, params);
        }
      } finally {
        settle();
      }
    },
    onProgress(token, listener) {
      listeners.set(token, listener);
      return () => listeners.delete(token);
    },
    hostInstance: () => host,
    async ensure() {
      await open();
    },
    close() {
      clearTimeout(idle);
      release();
    },
  };
}

/** The bundled reference (`mostra docs`), read as the MCP server's docs. */
export function bundledDocs(): McpDocs {
  let topics: ReturnType<typeof docsIndex> | undefined;
  const all = (): ReturnType<typeof docsIndex> => {
    topics ??= docsIndex();
    return topics;
  };
  const cache = new Map<string, string>();
  return {
    topics: (): DocsTopicSummary[] =>
      all().map((topic) => ({ topic: topic.topic, title: topic.title, url: topic.url })),
    read(topic) {
      const cached = cache.get(topic);
      if (cached !== undefined) return cached;
      const found = all().find((entry) => entry.topic === topic);
      if (found === undefined) return undefined;
      const markdown = topicMarkdown(found, skillDir(), MCP_GUIDE_LINKS);
      cache.set(topic, markdown);
      return markdown;
    },
  };
}

/** What both transports are given. */
export interface ServeOptions {
  readonly home: string;
  readonly env: Environment;
  readonly workspace: string;
  readonly version: string;
  readonly log: (line: string) => void;
  /**
   * Told each MCP client the server serves (for telemetry, which counts each once), with the
   * instance, so the count can wait to learn whether it was host-spawned.
   */
  readonly onClient: (client: McpClientInfo, instance: DaemonInstance) => void;
}

function factoryFor(options: ServeOptions, instance: DaemonInstance) {
  return createMcpServerFactory({
    instance,
    workspace: localWorkspace(options.workspace),
    docs: bundledDocs(),
    browser: { open: (url) => openInBrowser(url, options.env) },
    version: options.version,
    onClient: (client) => options.onClient(client, instance),
  });
}

/** Resolves when the process is asked to stop: Ctrl-C, SIGTERM, SIGHUP, or Ctrl+Break on Windows. */
function stopSignal(): Promise<string> {
  return new Promise((resolve) => {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
      process.once(signal, () => resolve(signal));
    }
  });
}

/** Serves over stdio until the client closes stdin or the process is stopped. */
export async function serveOverStdio(options: ServeOptions): Promise<DaemonInstance> {
  const instance = daemonInstance(options);
  const handle = serveStdio(factoryFor(options, instance), {
    onerror: (error) => options.log(`mostra mcp: ${error.message}`),
  });
  const ended = new Promise<string>((resolve) => {
    process.stdin.once("end", () => resolve("stdin"));
    process.stdin.once("close", () => resolve("stdin"));
  });
  await Promise.race([ended, stopSignal()]);
  await handle.close().catch(() => {});
  instance.close();
  return instance;
}

/** The address and URL host of `--bind` and `--url-host` (D99's rules, D164 item 3). */
export function mcpBind(options: { readonly bind?: string; readonly urlHost?: string }): {
  readonly address: string;
  readonly urlHost: string;
} {
  const fail = (message: string): RpcError =>
    new RpcError(createDiagnostic("MOSTRA_ENV_BIND_FAILED", { message }));
  const address = (options.bind ?? "127.0.0.1").replace(/^\[(.*)\]$/, "$1");
  if (isIP(address) === 0)
    throw fail(`--bind takes an IP address, such as 127.0.0.1, not "${options.bind}".`);
  if (options.urlHost !== undefined && options.bind === undefined) {
    throw fail("--url-host needs --bind: without it the server listens on 127.0.0.1 only.");
  }
  const canonical = new URL(`http://${isIP(address) === 6 ? `[${address}]` : address}/`).hostname;
  const wildcard = canonical === "0.0.0.0" || canonical === "[::]" || canonical === "[::ffff:0:0]";
  if (wildcard && options.urlHost === undefined) {
    throw fail(
      `--bind ${options.bind} listens on every interface; name the host clients use with --url-host.`,
    );
  }
  if (options.urlHost !== undefined && !/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)$/i.test(options.urlHost)) {
    throw fail(`--url-host takes a host name or an IP address, not "${options.urlHost}".`);
  }
  return { address, urlHost: (options.urlHost ?? canonical).toLowerCase() };
}

/** The bearer token: `MOSTRA_MCP_TOKEN`, or one made for this run (160 bits). */
export function mcpToken(env: Environment): {
  readonly token: string;
  readonly generated: boolean;
} {
  const given = env["MOSTRA_MCP_TOKEN"];
  if (given !== undefined && given !== "") {
    if (given.length < 26 || /\s/.test(given)) {
      throw new RpcError(
        createDiagnostic("MOSTRA_CLI_USAGE", {
          message: "MOSTRA_MCP_TOKEN must be at least 26 characters with no spaces.",
        }),
      );
    }
    return { token: given, generated: false };
  }
  return { token: randomBytes(20).toString("base64url"), generated: true };
}

/** A request's headers as `[name, value]` pairs in arrival order (Node's `rawHeaders`). */
function pairs(incoming: Pick<IncomingMessage, "rawHeaders">): [string, string][] {
  const raw = incoming.rawHeaders;
  const out: [string, string][] = [];
  for (let index = 0; index + 1 < raw.length; index += 2)
    out.push([raw[index] as string, raw[index + 1] as string]);
  return out;
}

/** Serves Streamable HTTP until the process is stopped; tells `onListening` where. */
export async function serveOverHttp(
  options: ServeOptions & {
    readonly port: number;
    readonly bind?: string;
    readonly urlHost?: string;
    readonly onListening: (where: {
      readonly url: string;
      readonly port: number;
      readonly token: string;
      readonly generated: boolean;
    }) => void;
  },
): Promise<DaemonInstance> {
  const { address, urlHost } = mcpBind({
    ...(options.bind !== undefined ? { bind: options.bind } : {}),
    ...(options.urlHost !== undefined ? { urlHost: options.urlHost } : {}),
  });
  const { token, generated } = mcpToken(options.env);
  const instance = daemonInstance(options);
  const factory = factoryFor(options, instance);
  let endpoint: ReturnType<typeof createHttpEndpoint> | undefined;
  const server = serve({
    fetch: (request: Request, env: { incoming: Pick<IncomingMessage, "url" | "rawHeaders"> }) => {
      if (endpoint === undefined) return new Response(null, { status: 503 });
      return endpoint.fetch(request, {
        target: env.incoming.url ?? "/",
        headers: pairs(env.incoming),
      });
    },
    port: options.port,
    hostname: address,
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) =>
      reject(
        new RpcError(
          createDiagnostic("MOSTRA_ENV_BIND_FAILED", {
            message: `The MCP server couldn't listen on ${address}:${options.port} (${error.code ?? error.message}).`,
          }),
        ),
      ),
    );
    server.once("listening", () => {
      const bound = server.address();
      resolve(typeof bound === "object" && bound !== null ? bound.port : options.port);
    });
  });
  // Browsers close idle connections before the server does (D157); harmless for programs.
  if ("keepAliveTimeout" in server) {
    (server as { keepAliveTimeout: number; headersTimeout: number }).keepAliveTimeout = 305_000;
    (server as { keepAliveTimeout: number; headersTimeout: number }).headersTimeout = 306_000;
  }
  const origin = `http://${urlHost}:${port}`;
  endpoint = createHttpEndpoint(factory, {
    origin,
    hosts: [`${urlHost}:${port}`],
    token,
    onRefusal: (refused) =>
      options.log(`mostra mcp: refused a request (${refused.status} ${refused.code})`),
    onError: (error) => options.log(`mostra mcp: ${error.message}`),
  });
  options.onListening({ url: `${origin}${MCP_PATH}`, port, token, generated });
  await stopSignal();
  await endpoint.close().catch(() => {});
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    // Idle connections are kept for minutes; ending the server ends them now.
    (server as { closeAllConnections?: () => void }).closeAllConnections?.();
  });
  instance.close();
  return instance;
}
