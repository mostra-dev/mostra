/**
 * The remote server (ARCHITECTURE §15, INTERFACES §18, D165): one process holding many hosted
 * homes behind one listener. It speaks plain HTTP behind a TLS terminator and routes every request
 * by its exact `Host`: the API origin (the network binding, version files, sign-in) or a
 * user-content domain (the hosted shell on its apex, an artifact's pages on its route's label).
 * It runs no artifact code: server code runs on each artifact's owner instance, through the relay.
 *
 * ```ts
 * const server = await startServer({ data: "/var/lib/mostra", config: readServerConfig(file, env), … });
 * // … mostra-runtime server serves until it is stopped
 * await server.close();
 * ```
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { getRequestListener } from "@hono/node-server";
import { createDiagnostic, type Diagnostic, RouteId, RpcError } from "@mostra/protocol";
import { locateShell, shellAssetResponse } from "../gateway/index.ts";
import { appendEvent } from "../interaction/index.ts";
import type { LedgerOwner } from "../ledger/index.ts";
import type { Environment, Log } from "../log.ts";
import { type Api, createApi } from "./api.ts";
import { type Authorization, createAuthorization } from "./auth.ts";
import type { RemoteServerConfig } from "./config.ts";
import { type DataDirectory, type HomeAssembler, openDataDirectory } from "./data.ts";
import { type HostedHome, openHostedHome } from "./hosted.ts";

export { type RemoteServerConfig, readServerConfig } from "./config.ts";

/** Options for {@link startServer}. */
export interface ServerOptions {
  /** The data directory (`--data`). */
  readonly data: string;
  readonly config: RemoteServerConfig;
  /** `host:port` to listen on (`--listen`). Default `127.0.0.1:8080`. */
  readonly listen?: string;
  /** Homes restored from a backup by hand (`--restored`): their incarnations rotate first. */
  readonly restored?: readonly string[];
  readonly runtimeVersion: string;
  readonly owner: LedgerOwner;
  readonly log: Log;
  readonly env: Environment;
}

/** A running remote server. */
export interface RemoteServer {
  /** Where it listens: `http://host:port`. */
  readonly address: string;
  readonly config: RemoteServerConfig;
  /** Stops listening, closes every hosted home, then the directory, and releases the locks. */
  close(): Promise<void>;
}

/** An answer as JSON, with the headers every server answer carries. */
function json(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(text);
}

function refusal(response: ServerResponse, status: number, diagnostic: Diagnostic): void {
  json(response, status, diagnostic);
}

/** Splits `host:port`, with `[::1]:port` for IPv6. */
function parseListen(listen: string): { host: string; port: number } {
  const match = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(listen);
  if (!match) {
    throw new RpcError(
      createDiagnostic("MOSTRA_REMOTE_CONFIG_INVALID", {
        message: `--listen ${listen} isn't host:port.`,
      }),
    );
  }
  return { host: (match[1] as string).replace(/^\[|\]$/g, ""), port: Number(match[2]) };
}

/** Starts the remote server: its data directory, then its listener. */
export async function startServer(options: ServerOptions): Promise<RemoteServer> {
  const { config, log } = options;
  // The authorization server is made once the directory is open; homes open only after that.
  let auth: Authorization | undefined;
  const shellDir = locateShell(options.env);
  const assembler: HomeAssembler<HostedHome> = {
    assemble: (home) =>
      openHostedHome({
        id: home.id,
        dir: home.dir,
        ledger: home.ledger,
        incarnation: home.incarnation,
        directory: data.directory,
        filesDir: join(options.data, "files"),
        auth: auth as Authorization,
        runtimeVersion: options.runtimeVersion,
        log,
        scheme: config.scheme ?? "https",
        domains: { active: config.domains.active, spares: config.domains.spares ?? [] },
        shellDir,
        relay: {
          waitingRunsPerArtifact: config.relay?.waitingRunsPerArtifact,
          drainPerSecond: config.relay?.drainPerSecond,
          ...(options.env["MOSTRA_TEST_RELAY_LIVE_MS"] !== undefined
            ? { liveRenewMs: Number(options.env["MOSTRA_TEST_RELAY_LIVE_MS"]) }
            : {}),
          ...(options.env["MOSTRA_TEST_RELAY_SWEEP_MS"] !== undefined
            ? { sweepMs: Number(options.env["MOSTRA_TEST_RELAY_SWEEP_MS"]) }
            : {}),
        },
      }),
    disassemble: (home) => home.stop(),
    incarnation: (home) => home.incarnation(),
    busy: (home) => home.busy(),
  };
  const data: DataDirectory<HostedHome> = await openDataDirectory({
    dir: options.data,
    runtimeVersion: options.runtimeVersion,
    owner: options.owner,
    log,
    env: options.env,
    assembler,
    ...(options.restored !== undefined ? { restored: options.restored } : {}),
    ...(config.homes?.idleCloseMinutes !== undefined
      ? { idleCloseMs: config.homes.idleCloseMinutes * 60_000 }
      : {}),
    ...(config.ledger?.walAutocheckpoint !== undefined
      ? { walAutocheckpoint: config.ledger.walAutocheckpoint }
      : {}),
  });
  auth = createAuthorization({
    directory: data.directory,
    config,
    log,
    // A new instance link is a hosted event the account's instances see (§18.5).
    linked: ({ homeId, linkId, name }) => {
      void data.home(homeId).then(
        (home) =>
          home.assembled.ledger.write((db) =>
            appendEvent(db, {
              artifactId: null,
              type: "instance.linked",
              actor: { kind: "mostra" },
              payload: { instanceId: linkId, name },
            }),
          ),
        (error: unknown) => log.error("server.linked_event_failed", { home: homeId, error }),
      );
    },
  });
  const api: Api = createApi({
    config,
    auth,
    log,
    filesDir: join(options.data, "files"),
    home: async (id) => (await data.home(id)).assembled,
    touch: (id) => data.touch(id),
  });
  const apiHost = new URL(config.apiOrigin).host;
  const domains = new Set([config.domains.active, ...(config.domains.spares ?? [])]);

  const onRequest = (request: IncomingMessage, response: ServerResponse): void => {
    const host = (request.headers.host ?? "").toLowerCase();
    // Cookies never reach anything on a hosted host (D165 item 8): dropped before routing.
    delete request.headers.cookie;
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    if (host === apiHost) {
      if (request.method === "GET" && path === "/health") {
        json(response, 200, { status: "ok", homes: data.open().length });
        return;
      }
      api.request(request, response, path).catch((error: unknown) => {
        log.error("server.api_failed", { path, error });
        if (!response.headersSent) {
          refusal(
            response,
            500,
            createDiagnostic("MOSTRA_HOST_INTERNAL_ERROR", {
              message: "The server failed to answer.",
            }),
          );
        } else response.destroy();
      });
      return;
    }
    const domain = [...domains].find(
      (candidate) => host === candidate || host.endsWith(`.${candidate}`),
    );
    if (domain === undefined) {
      refusal(
        response,
        421,
        createDiagnostic("MOSTRA_HYGIENE_HOST_REFUSED", {
          message: "This server serves no pages at this host.",
        }),
      );
      return;
    }
    // Every hosted answer keeps its page in an agent cluster of its own and out of indexes
    // (ARCHITECTURE §15.6, D161).
    response.setHeader("origin-agent-cluster", "?1");
    response.setHeader("x-robots-tag", "noindex");
    hosted(request, response, host, domain, path).catch((error: unknown) => {
      log.error("server.hosted_failed", { error });
      if (!response.headersSent) {
        refusal(
          response,
          500,
          createDiagnostic("MOSTRA_HOST_INTERNAL_ERROR", {
            message: "The server failed to answer.",
          }),
        );
      } else response.destroy();
    });
  };

  const notServed = (response: ServerResponse): void =>
    refusal(
      response,
      404,
      createDiagnostic("MOSTRA_HYGIENE_NOT_SERVED", { message: "Nothing is served at this path." }),
    );

  /** The shell's own files, the same on every domain's apex. */
  const assets = getRequestListener(
    async (request: Request) =>
      (shellDir === undefined ? undefined : await shellAssetResponse(shellDir, request)) ??
      new Response(
        JSON.stringify(
          createDiagnostic("MOSTRA_HYGIENE_NOT_SERVED", { message: "No shell file at this path." }),
        ),
        {
          status: 404,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        },
      ),
    { overrideGlobalObjects: false },
  );

  /** A route of the directory: its home and ID, by ID or by label. */
  const routeBy = (column: "id" | "label", value: string) =>
    data.directory.read((db) =>
      db.get<{ id: string; home_id: string }>(
        `SELECT id, home_id FROM artifact_route WHERE ${column} = ?`,
        value,
      ),
    );

  /** A request on a user-content domain: the shell on its apex, a route's frames on its label. */
  const hosted = async (
    request: IncomingMessage,
    response: ServerResponse,
    host: string,
    domain: string,
    path: string,
  ): Promise<void> => {
    if (host === domain) {
      if (path.startsWith("/_mostra/shell/assets/")) {
        await assets(request, response);
        return;
      }
      const match = /^\/a\/(rte_[0-9A-HJKMNP-TV-Z]{26})(?:\/|$)/.exec(path);
      const route =
        match?.[1] !== undefined && RouteId.is(match[1]) ? routeBy("id", match[1]) : undefined;
      if (!route) {
        notServed(response);
        return;
      }
      const home = await data.home(route.home_id);
      await home.assembled.serve(request, response, { kind: "shell", domain, routeId: route.id });
      return;
    }
    // One DNS label under the domain: a route's label, never issued twice (§18.4).
    const label = host.slice(0, host.length - domain.length - 1);
    const route = /^[0-9a-hjkmnp-tv-z]{26}$/.test(label) ? routeBy("label", label) : undefined;
    if (!route) {
      refusal(
        response,
        421,
        createDiagnostic("MOSTRA_HYGIENE_HOST_REFUSED", {
          message: "This server serves no pages at this host.",
        }),
      );
      return;
    }
    const home = await data.home(route.home_id);
    await home.assembled.serve(request, response, { kind: "frame", domain, routeId: route.id });
  };

  const listener: Server = createServer({ maxHeaderSize: 64 * 1024 }, onRequest);
  listener.keepAliveTimeout = 305_000;
  listener.headersTimeout = 30_000;
  listener.requestTimeout = 120_000;
  listener.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const host = (request.headers.host ?? "").toLowerCase();
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    if (host === apiHost) {
      api.upgrade(request, socket, head, path);
      return;
    }
    socket.end("HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n");
  });
  const { host, port } = parseListen(options.listen ?? "127.0.0.1:8080");
  try {
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(port, host, () => {
        listener.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await data.close();
    throw new RpcError(
      createDiagnostic("MOSTRA_ENV_BIND_FAILED", {
        message: `The server can't listen on ${host}:${port}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}.`,
      }),
    );
  }
  const bound = listener.address() as AddressInfo;
  const address = `http://${bound.family === "IPv6" ? `[${bound.address}]` : bound.address}:${bound.port}`;
  log.info("server.listening", { address, apiOrigin: config.apiOrigin, domains: [...domains] });
  let closing: Promise<void> | undefined;
  return {
    address,
    config,
    close() {
      closing ??= (async () => {
        api.close();
        await new Promise<void>((resolve) => {
          listener.close(() => resolve());
          listener.closeAllConnections();
        });
        await data.close();
        log.info("server.stopped", {});
      })();
      return closing;
    },
  };
}
