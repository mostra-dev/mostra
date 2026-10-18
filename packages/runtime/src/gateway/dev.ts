/**
 * The dev sandbox's artifact origin in front of `mostra dev`'s Vite server (D140 item 12): every
 * file request and the HMR WebSocket pass the gateway's checks first (exact Host and Origin, the
 * origin-bound frame session), then reach the dev server on loopback with the session's secret,
 * which nothing else holds. Mostra's cookies never go upstream (D38).
 */
import { request as httpRequest, type IncomingMessage } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { DEV_SECRET_HEADER } from "../builder/index.ts";

/** Where a dev session's server listens, and the secret it wants. */
export interface DevUpstream {
  readonly port: number;
  readonly secret: string;
}

/** Request headers the gateway passes to the dev server; everything else stays (cookies above all). */
const FORWARDED = [
  "accept",
  "accept-language",
  "if-none-match",
  "if-modified-since",
  "user-agent",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
] as const;

/** Response headers the gateway passes back; its own security headers are added by the caller. */
const RETURNED = [
  "content-type",
  "etag",
  "last-modified",
  "cache-control",
  "content-length",
] as const;

/** Fetches `path` from the dev server; resolves with its status, headers and body. */
export function devFetch(
  upstream: DevUpstream,
  request: Request,
  path: string,
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const headers: Record<string, string> = {
    host: `127.0.0.1:${upstream.port}`,
    [DEV_SECRET_HEADER]: upstream.secret,
  };
  for (const name of FORWARDED) {
    const value = request.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      {
        host: "127.0.0.1",
        port: upstream.port,
        method: request.method,
        path,
        headers,
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const back: Record<string, string> = {};
          for (const name of RETURNED) {
            const value = response.headers[name];
            if (typeof value === "string") back[name] = value;
          }
          resolve({
            status: response.statusCode ?? 502,
            headers: back,
            body: Buffer.concat(chunks),
          });
        });
        response.on("error", reject);
      },
    );
    outgoing.on("error", reject);
    outgoing.end();
  });
}

/**
 * Hands an upgrade the gateway accepted to the dev server: the request line and its headers, with
 * the secret added, the Host rewritten and Mostra's cookies removed, then both directions piped.
 */
export function devUpgrade(
  upstream: DevUpstream,
  incoming: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  const target = connect({ host: "127.0.0.1", port: upstream.port });
  const lines = [`${incoming.method ?? "GET"} ${incoming.url ?? "/"} HTTP/1.1`];
  for (let index = 0; index + 1 < incoming.rawHeaders.length; index += 2) {
    const name = incoming.rawHeaders[index] as string;
    const lower = name.toLowerCase();
    if (lower === "cookie" || lower === "host" || lower === DEV_SECRET_HEADER) continue;
    lines.push(`${name}: ${incoming.rawHeaders[index + 1] as string}`);
  }
  lines.push(`Host: 127.0.0.1:${upstream.port}`, `${DEV_SECRET_HEADER}: ${upstream.secret}`);
  const close = (): void => {
    target.destroy();
    socket.destroy();
  };
  target.on("error", close);
  socket.on("error", close);
  target.on("close", () => socket.destroy());
  socket.on("close", () => target.destroy());
  target.on("connect", () => {
    target.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) target.write(head);
    target.pipe(socket);
    socket.pipe(target);
  });
}
