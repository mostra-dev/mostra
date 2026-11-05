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
import type { Duplex } from "node:stream";
import { createDiagnostic, type Diagnostic, RpcError } from "@mostra/protocol";
import type { LedgerOwner } from "../ledger/index.ts";
import type { Environment, Log } from "../log.ts";
import type { RemoteServerConfig } from "./config.ts";
import { type DataDirectory, type HomeAssembler, openDataDirectory } from "./data.ts";

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

/** The parts of a hosted home the server builds over its ledger. */
interface HostedParts {
  readonly connections: number;
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
  const assembler: HomeAssembler<HostedParts> = {
    assemble: async () => ({ connections: 0 }),
    disassemble: async () => {},
    busy: (parts) => parts.connections > 0,
  };
  const data: DataDirectory<HostedParts> = await openDataDirectory({
    dir: options.data,
    runtimeVersion: options.runtimeVersion,
    owner: options.owner,
    log,
    env: options.env,
    assembler,
    ...(config.homes?.idleCloseMinutes !== undefined
      ? { idleCloseMs: config.homes.idleCloseMinutes * 60_000 }
      : {}),
    ...(config.ledger?.walAutocheckpoint !== undefined
      ? { walAutocheckpoint: config.ledger.walAutocheckpoint }
      : {}),
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
      refusal(
        response,
        404,
        createDiagnostic("MOSTRA_HYGIENE_NOT_SERVED", {
          message: "Nothing is served at this path.",
        }),
      );
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
    refusal(
      response,
      404,
      createDiagnostic("MOSTRA_HYGIENE_NOT_SERVED", { message: "Nothing is served at this path." }),
    );
  };

  const listener: Server = createServer({ maxHeaderSize: 64 * 1024 }, onRequest);
  listener.keepAliveTimeout = 305_000;
  listener.headersTimeout = 30_000;
  listener.requestTimeout = 120_000;
  listener.on("upgrade", (request: IncomingMessage, socket: Duplex) => {
    socket.end("HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n");
    void request;
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
