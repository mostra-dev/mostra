/**
 * One gateway listener: a Node HTTP server on a leased port with a Hono app behind it. Every
 * request's envelope (exact `Host`, plain path, single headers) is checked before routing,
 * methods other than GET, HEAD and POST are refused, upgrades are refused after their `Origin`
 * check unless the listener takes them (a dev sandbox's HMR WebSocket, D140 item 12; terminals add
 * theirs, WP-22), and every response leaves with the base headers.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Socket } from "node:net";
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

/**
 * Node's limit on request headers for gateway listeners. Every port of the loopback host shares one
 * cookie jar, and any artifact's page can fill it; Chromium, Firefox and WebKit keep about 410 KB
 * per host (100 cookies of 4 KiB), so a jar filled to the brim fits with room to spare
 * (VERIFIED_FACTS, WP-05). A request past this limit is answered with a page that clears the
 * host's cookies (D98 item 9).
 */
export const MAX_HEADER_SIZE: number = 1024 * 1024;

/**
 * How long a listener keeps an idle connection open: longer than browsers keep theirs (Chromium
 * 300 s, Firefox 115 s), so the browser reuses its connections and closes them itself (D157 item
 * 2). Node's default, 5 s, made the gateway close first, and each connection it closed stayed in
 * TIME_WAIT on its side, where Chromium's random local ports on Windows collided with it and
 * failed the connect at once with `ERR_NO_BUFFER_SPACE` (#66).
 */
export const KEEP_ALIVE_MS: number = 305_000;

/** A listener: its server and its Hono app. */
export interface Listener {
  readonly server: Server;
  readonly app: Hono<HttpEnv>;
  /** Stops accepting connections and closes the open ones. */
  close(): Promise<void>;
}

/** Writes a refusal straight to a socket, for upgrades and envelope failures before Hono. */
function writeRaw(
  socket: Duplex,
  refused: Refusal,
  extra: { readonly html?: string; readonly headers?: readonly string[] } = {},
): void {
  const body = extra.html ?? JSON.stringify(refused.diagnostic);
  const headers = [
    `HTTP/1.1 ${refused.status} Refused`,
    "connection: close",
    extra.html !== undefined
      ? "content-type: text/html; charset=utf-8"
      : "content-type: application/json; charset=utf-8",
    `content-length: ${Buffer.byteLength(body)}`,
    "cache-control: no-store",
    ...Object.entries(BASE_HEADERS).map(([name, value]) => `${name}: ${value}`),
    ...(extra.headers ?? []),
  ];
  socket.end(`${headers.join("\r\n")}\r\n\r\n${body}`);
  lingerAfterRefusal(socket);
}

/** Connections already answered with a refusal: a later parse error on them changes nothing. */
const refusedSockets = new WeakSet<Duplex>();

/** How long a refused connection is read before it is closed regardless. */
const LINGER_MS = 5000;
/** How much of a refused request is read and dropped before the connection is closed. */
const LINGER_BYTES = 16 * 1024 * 1024;

/**
 * Reads and drops what the client is still sending after its refusal, until it closes the
 * connection, for at most {@link LINGER_MS} and {@link LINGER_BYTES}. A socket closed with unread
 * bytes is reset, and a reset can reach the client before it read the answer, which it then never
 * sees: on Windows a browser sending a megabyte of cookies got a reset instead of the page that
 * clears them (WP-W2). The answer is already written; this only keeps the connection open long
 * enough for it to be read, as HTTP servers do for a "lingering close".
 */
function lingerAfterRefusal(socket: Duplex): void {
  refusedSockets.add(socket);
  // Node's HTTP server keeps feeding what arrives to the request parser that just failed, which
  // fails again (a second `clientError`) and ends the connection: from here on this reads alone.
  socket.removeAllListeners("data");
  socket.once("end", () => socket.destroy());
  let read = 0;
  const timer = setTimeout(() => socket.destroy(), LINGER_MS);
  timer.unref();
  socket.once("close", () => clearTimeout(timer));
  socket.on("error", () => socket.destroy());
  socket.on("data", (chunk: Buffer) => {
    read += chunk.length;
    if (read > LINGER_BYTES) socket.destroy();
  });
  socket.resume();
}

/**
 * The answer to headers past {@link MAX_HEADER_SIZE}: a page that says what happened and clears
 * the host's cookies, which is what made them that large (D98 item 9). `Clear-Site-Data` acts on
 * the host, so it empties the jar every port shares; Mostra's sessions return when a link is
 * opened again. The page runs nothing and can't be framed.
 */
function headersTooLarge(socket: Duplex): void {
  const refused = refusal(
    "MOSTRA_HYGIENE_HEADERS_TOO_LARGE",
    "This browser sent more cookies than any page here sets.",
  );
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mostra</title><style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:.25rem;padding:2rem;text-align:center;color-scheme:light dark}h1{font-size:1.25rem;margin:0}p{margin:0;opacity:.8}code{opacity:.5;font-size:.75rem;margin-top:1rem}</style></head><body><h1>This browser sent more cookies than Mostra accepts</h1><p>A page on this machine filled them. They have been cleared: open your link again.</p><code>MOSTRA_HYGIENE_HEADERS_TOO_LARGE</code></body></html>`;
  writeRaw(socket, refused, {
    html,
    headers: [
      'clear-site-data: "cookies"',
      "content-security-policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
    ],
  });
}

/**
 * Records every connection and request of a listener in the supervisor's log: its arrival and its
 * end, whether it was answered, with the time between them and the client's port, so a request a
 * browser saw go unanswered shows whether it ever reached the gateway (#66). Only a request's
 * method and path are kept, never its query (a frame ticket travels there) or its headers; a test
 * switch (`MOSTRA_TEST_REQUEST_LOG`), since a long-lived daemon would log every asset it serves.
 */
function traceRequests(server: Server, log: Log, origin: () => string): void {
  server.on("connection", (socket: Socket) => {
    const opened = Date.now();
    const client = socket.remotePort;
    log.info("gateway.connection", { origin: origin(), client });
    socket.once("close", (hadError: boolean) =>
      log.info("gateway.connection_closed", {
        origin: origin(),
        client,
        ms: Date.now() - opened,
        read: socket.bytesRead,
        written: socket.bytesWritten,
        ...(hadError ? { hadError } : {}),
      }),
    );
  });
  server.prependListener("request", (incoming: IncomingMessage, outgoing) => {
    const started = Date.now();
    const fields = {
      origin: origin(),
      client: incoming.socket.remotePort,
      method: incoming.method,
      path: (incoming.url ?? "").replace(/[?#].*$/s, ""),
    };
    log.info("gateway.request", fields);
    // `finished`: the whole answer was handed to the connection. A stream (events, a long poll)
    // the browser leaves ends unfinished with its headers sent; a request that got nothing ends
    // with neither.
    outgoing.once("close", () =>
      log.info("gateway.request_closed", {
        ...fields,
        status: outgoing.statusCode,
        headersSent: outgoing.headersSent,
        finished: outgoing.writableFinished,
        ms: Date.now() - started,
      }),
    );
  });
}

/** Creates a listener whose routes `configure` mounts; the server isn't bound yet. */
export function createListener(options: {
  readonly policy: () => RequestPolicy;
  readonly log: Log;
  readonly frameAncestors: () => string;
  readonly configure: (app: Hono<HttpEnv>) => void;
  /**
   * Takes an upgrade whose Host, target and Origin passed the checks (a dev sandbox's HMR
   * WebSocket, D140 item 12), or answers why it is refused. Without it every upgrade is refused.
   */
  readonly upgrade?: (
    incoming: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => Refusal | undefined;
  /** Logs every connection and request ({@link traceRequests}): tests only. */
  readonly traceRequests?: boolean;
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
  if (options.traceRequests) traceRequests(server, options.log, () => options.policy().origin);
  // A client that sends something Node can't parse gets a 400 and its connection closed.
  server.on("clientError", (error: NodeJS.ErrnoException, socket) => {
    if (refusedSockets.has(socket)) return;
    if (!socket.writable) {
      socket.destroy();
      return;
    }
    if (error.code === "HPE_HEADER_OVERFLOW") {
      options.log.warn("gateway.refused", {
        code: "MOSTRA_HYGIENE_HEADERS_TOO_LARGE",
        status: 431,
        origin: options.policy().origin,
      });
      headersTooLarge(socket);
      return;
    }
    writeRaw(
      socket,
      refusal("MOSTRA_HYGIENE_REQUEST_MALFORMED", "The request couldn't be parsed."),
    );
  });
  server.on("upgrade", (incoming: IncomingMessage, socket: Duplex, head: Buffer) => {
    const policy = options.policy();
    const checked = checkRequest(policy, {
      method: incoming.method ?? "",
      target: incoming.url ?? "",
      headers: headerPairs(incoming),
      intent: "upgrade",
    });
    const refused =
      checked ??
      (options.upgrade
        ? options.upgrade(incoming, socket, head)
        : refusal("MOSTRA_HYGIENE_NOT_SERVED", "This gateway serves no WebSocket here."));
    if (refused === undefined) return;
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
  // An idle connection waits for its next request without these two limits, which count from a
  // request's first byte.
  server.keepAliveTimeout = KEEP_ALIVE_MS;

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
