/**
 * Requests from an owner instance to a remote server's API origin over HTTPS (or HTTP for a
 * loopback test server): the device grant, token refreshes and revocations, and version files
 * (INTERFACES §18.2, §18.5). One place, so every request bounds its time and its answer's size and
 * never logs what it sends. `MOSTRA_TEST_SERVER_ADDRESS` (`host:port`) points every request at a
 * test server listening on loopback under the server's own `Host`.
 */
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { createDiagnostic, RpcError } from "@mostra/protocol";

/** How long a request to the server may take. */
export const REMOTE_REQUEST_TIMEOUT_MS = 30_000;
/** The largest answer the instance reads (the API answers JSON; files go the other way). */
const MAX_ANSWER_BYTES = 4 * 1024 * 1024;

/** Where requests for `server` actually go: the test override, or the server's own host. */
export interface RemoteAddress {
  readonly host: string;
  /** Absent: the server URL's own port. */
  readonly port?: number | undefined;
}

/** Reads the test override, `host:port`, or nothing. */
export function testServerAddress(value: string | undefined): RemoteAddress | undefined {
  if (!value) return undefined;
  // A bare address keeps every server URL's own port (tests with several servers).
  if (/^[\d.]+$/.test(value)) return { host: value };
  const at = value.lastIndexOf(":");
  const port = Number(value.slice(at + 1));
  if (at <= 0 || !Number.isInteger(port) || port <= 0 || port > 65535) return undefined;
  return { host: value.slice(0, at).replace(/^\[|\]$/g, ""), port };
}

/** An answer: its status, headers and body. */
export interface RemoteAnswer {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

/** The diagnostic for a server that can't be reached, naming it (never what was sent). */
export function unreachable(server: string, why: string): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_REMOTE_UNREACHABLE", {
      message: `${server} can't be reached: ${why}.`,
    }),
  );
}

/** Sends one request to `server` (an API origin) and reads its answer. */
export function remoteRequest(
  server: string,
  path: string,
  init: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string | Buffer;
    readonly connectTo?: RemoteAddress;
    readonly timeoutMs?: number;
  } = {},
): Promise<RemoteAnswer> {
  const url = new URL(path, server);
  const secure = url.protocol === "https:";
  const send = secure ? httpsRequest : httpRequest;
  const port = Number(url.port) || (secure ? 443 : 80);
  return new Promise((resolve, reject) => {
    const outgoing = send(
      {
        host: init.connectTo?.host ?? url.hostname,
        port: init.connectTo?.port ?? port,
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "GET",
        headers: {
          host: url.host,
          ...(init.body !== undefined
            ? { "content-length": String(Buffer.byteLength(init.body)) }
            : {}),
          ...init.headers,
        },
        ...(secure ? { servername: url.hostname } : {}),
        timeout: init.timeoutMs ?? REMOTE_REQUEST_TIMEOUT_MS,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        let size = 0;
        incoming.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_ANSWER_BYTES) {
            incoming.destroy();
            reject(unreachable(server, "its answer was too large"));
            return;
          }
          chunks.push(chunk);
        });
        incoming.on("end", () =>
          resolve({
            status: incoming.statusCode ?? 0,
            headers: incoming.headers,
            body: Buffer.concat(chunks),
          }),
        );
        incoming.on("error", (error) => reject(unreachable(server, error.message)));
      },
    );
    outgoing.on("timeout", () => outgoing.destroy(new Error("no answer in time")));
    outgoing.on("error", (error) => reject(unreachable(server, error.message)));
    if (init.body !== undefined) outgoing.write(init.body);
    outgoing.end();
  });
}

/** Posts a form and reads a JSON answer, whatever its status. */
export async function postForm(
  server: string,
  path: string,
  fields: Record<string, string>,
  connectTo?: RemoteAddress,
  bearer?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const answer = await remoteRequest(server, path, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      ...(bearer !== undefined ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: new URLSearchParams(fields).toString(),
    ...(connectTo ? { connectTo } : {}),
  });
  let json: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(answer.body.toString("utf8")) as unknown;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      json = parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON: the caller reads the status alone.
  }
  return { status: answer.status, json };
}
