/**
 * One gateway listener: a Node HTTP server on a leased port with a Hono app behind it. Every
 * request's envelope (exact `Host`, plain path, single headers) is checked before routing,
 * methods other than GET, HEAD and POST are refused, upgrades are refused after their `Origin`
 * check (no WebSocket endpoint exists yet; terminals add one, WP-21), and every response leaves
 * with the base headers.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { getRequestListener } from "@hono/node-server";
import {
  checkRequest,
  createDiagnostic,
  type Refusal,
  type RequestPolicy,
  refusal,
} from "@mostra/protocol";
import { Hono } from "hono";
import type { Log } from "../log.ts";
import { BASE_HEADERS, type HttpEnv, headerPairs, refusalResponse } from "./http.ts";
import { refuse } from "./routes.ts";

/** Node's limit on request headers for gateway listeners; cookies of many artifacts share a host. */
const MAX_HEADER_SIZE = 32 * 1024;

/** A listener: its server and its Hono app. */
export interface Listener {
  readonly server: Server;
  readonly app: Hono<HttpEnv>;
  /** Stops accepting connections and closes the open ones. */
  close(): Promise<void>;
}

/** Writes a refusal straight to a socket, for upgrades and envelope failures before Hono. */
function writeRaw(socket: Duplex, refused: Refusal): void {
  const body = JSON.stringify(refused.diagnostic);
  const headers = [
    `HTTP/1.1 ${refused.status} Refused`,
    "connection: close",
    "content-type: application/json; charset=utf-8",
    `content-length: ${Buffer.byteLength(body)}`,
    ...Object.entries(BASE_HEADERS).map(([name, value]) => `${name}: ${value}`),
  ];
  socket.end(`${headers.join("\r\n")}\r\n\r\n${body}`);
}

/** Creates a listener whose routes `configure` mounts; the server isn't bound yet. */
export function createListener(options: {
  readonly policy: () => RequestPolicy;
  readonly log: Log;
  readonly frameAncestors: () => string;
  readonly configure: (app: Hono<HttpEnv>) => void;
}): Listener {
  const app = new Hono<HttpEnv>();
  options.configure(app);
  app.notFound((c) =>
    refuse(options, refusal("MOSTRA_HYGIENE_NOT_SERVED", "Nothing is served at this path."), {
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      document: false,
    }),
  );
  app.onError((error, c) => {
    options.log.error("gateway.handler_failed", { error, path: new URL(c.req.url).pathname });
    return refusalResponse(
      {
        status: 500,
        diagnostic: createDiagnostic("MOSTRA_HOST_INTERNAL_ERROR", {
          message: "The gateway failed to answer this request.",
        }),
      },
      { document: false, method: c.req.method },
    );
  });
  const listener = getRequestListener(app.fetch, { overrideGlobalObjects: false });

  const server = createServer({ maxHeaderSize: MAX_HEADER_SIZE }, (incoming, outgoing) => {
    const policy = options.policy();
    const method = incoming.method ?? "";
    const envelope =
      checkRequest(policy, {
        method,
        target: incoming.url ?? "",
        headers: headerPairs(incoming),
      }) ??
      (method === "GET" || method === "HEAD" || method === "POST"
        ? undefined
        : method === "OPTIONS"
          ? // A preflight never gets an Access-Control-* answer: no other origin may call in.
            refusal(
              "MOSTRA_HYGIENE_ORIGIN_REFUSED",
              "This gateway answers no cross-origin requests.",
            )
          : refusal(
              "MOSTRA_HYGIENE_NOT_SERVED",
              `This gateway doesn't serve ${method} requests.`,
              405,
            ));
    if (envelope) {
      options.log.warn("gateway.refused", {
        code: envelope.diagnostic.code,
        status: envelope.status,
        method,
        origin: policy.origin,
      });
      const response = refusalResponse(envelope, { document: false, method });
      // A request refused before routing ends its connection: nothing else is read from it.
      outgoing.shouldKeepAlive = false;
      outgoing.writeHead(response.status, {
        ...Object.fromEntries(response.headers),
        connection: "close",
      });
      void response.text().then((text) => outgoing.end(text));
      return;
    }
    void listener(incoming, outgoing);
  });
  // A client that sends something Node can't parse gets a 400 and its connection closed.
  server.on("clientError", (_error, socket) => {
    if (socket.writable) {
      writeRaw(
        socket,
        refusal("MOSTRA_HYGIENE_REQUEST_MALFORMED", "The request couldn't be parsed."),
      );
    } else socket.destroy();
  });
  server.on("upgrade", (incoming: IncomingMessage, socket: Duplex) => {
    const policy = options.policy();
    const refused =
      checkRequest(policy, {
        method: incoming.method ?? "",
        target: incoming.url ?? "",
        headers: headerPairs(incoming),
        intent: "upgrade",
      }) ?? refusal("MOSTRA_HYGIENE_NOT_SERVED", "This gateway serves no WebSocket here.");
    options.log.warn("gateway.refused", {
      code: refused.diagnostic.code,
      status: refused.status,
      method: "UPGRADE",
      origin: policy.origin,
    });
    writeRaw(socket, refused);
  });
  server.headersTimeout = 30_000;
  server.requestTimeout = 120_000;

  return {
    server,
    app,
    close: () =>
      new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
