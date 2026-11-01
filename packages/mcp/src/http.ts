/**
 * The MCP server over Streamable HTTP (D164 item 3, HY-01 item 13): the SDK's per-request handler
 * behind the same request checks the gateway runs (`@mostra/protocol`'s `hygiene`, D96) and a
 * bearer token. A loopback port admits every local user and process, and the control socket only
 * its owner; the token is what keeps the endpoint from handing out what the socket guards.
 *
 * ```ts
 * const endpoint = createHttpEndpoint(createMcpServerFactory(options), {
 *   origin: "http://127.0.0.1:23456", hosts: ["127.0.0.1:23456"], token,
 * });
 * const response = await endpoint.fetch(request, { target: req.url, headers: rawPairs });
 * ```
 */
import { createMcpHandler, type McpServerFactory } from "@modelcontextprotocol/server";
import {
  checkRequest,
  type Refusal,
  type RequestPolicy,
  refusal,
  safeEqual,
} from "@mostra/protocol";

/** The path the endpoint serves. */
export const MCP_PATH = "/mcp";

/** The largest request body the endpoint reads: a whole artifact's files fit (16 MiB). */
export const MCP_MAX_BODY_BYTES: number = 16 * 1024 * 1024;

/** Failed tokens past this many in {@link GUESS_WINDOW_MS} refuse every token (D97 item 8). */
export const GUESS_LIMIT = 30;
/** The guessing limit's window. */
export const GUESS_WINDOW_MS = 60_000;

/** How the endpoint is reached and what it requires. */
export interface HttpEndpointPolicy extends RequestPolicy {
  /** The bearer token every request must carry (`Authorization: Bearer <token>`). */
  readonly token: string;
  /** The clock; tests move it. */
  readonly now?: () => number;
  /** Told each refusal, for the server's log (never the token). */
  readonly onRefusal?: (refused: { readonly status: number; readonly code: string }) => void;
  /** Told an error the SDK met outside a request's answer. */
  readonly onError?: (error: Error) => void;
}

/** The request as the transport received it, before any URL parser normalized it. */
export interface RawRequest {
  /** The request target exactly as sent (`/mcp`, with any query). */
  readonly target: string;
  /** Every header in arrival order, so a repeated one is visible. */
  readonly headers: readonly (readonly [string, string])[];
}

/** The endpoint. */
export interface McpHttpEndpoint {
  /** Answers one request. Give `raw` where the transport has it (Node's `rawHeaders`, `req.url`). */
  fetch(request: Request, raw?: RawRequest): Promise<Response>;
  /** Ends every exchange in flight. */
  close(): Promise<void>;
}

/** Headers every answer carries (D98 item 6), and none of CORS's. */
function harden(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const name of [...headers.keys()]) {
    if (name.toLowerCase().startsWith("access-control-")) headers.delete(name);
  }
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** A refusal as a JSON-RPC error with its diagnostic, at its HTTP status. */
function refuse(refused: Refusal, extra: Record<string, string> = {}): Response {
  return harden(
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32000, message: refused.diagnostic.message, data: refused.diagnostic },
      }),
      { status: refused.status, headers: { "Content-Type": "application/json", ...extra } },
    ),
  );
}

/** Builds the endpoint. */
export function createHttpEndpoint(
  factory: McpServerFactory,
  policy: HttpEndpointPolicy,
): McpHttpEndpoint {
  if (policy.token.length < 26)
    throw new Error("The MCP endpoint's token must be at least 26 characters.");
  const now = policy.now ?? Date.now;
  const handler = createMcpHandler(factory, {
    legacy: "stateless",
    maxRequestBodySize: MCP_MAX_BODY_BYTES,
    ...(policy.onError !== undefined ? { onerror: policy.onError } : {}),
  });
  const failures: number[] = [];
  const expected = `Bearer ${policy.token}`;

  const refused = (result: Refusal, extra?: Record<string, string>): Response => {
    policy.onRefusal?.({ status: result.status, code: result.diagnostic.code });
    return refuse(result, extra);
  };

  return {
    async fetch(request, raw) {
      const url = new URL(request.url);
      const target = raw?.target ?? `${url.pathname}${url.search}`;
      const headers = raw?.headers ?? [...request.headers.entries()];
      const post = request.method === "POST";
      // The envelope first, for every method: Host, the target and the headers.
      const envelope = checkRequest(policy, {
        method: request.method,
        target,
        headers,
        ...(post ? { intent: "rpc" } : {}),
      });
      if (envelope) return refused(envelope);
      const path = target.split("?")[0];
      if (path !== MCP_PATH) {
        return refused(
          refusal("MOSTRA_HYGIENE_NOT_SERVED", `Only ${MCP_PATH} is served here.`, 404),
        );
      }
      if (!post) {
        return refused(
          refusal("MOSTRA_HYGIENE_NOT_SERVED", "The MCP endpoint takes POST requests only.", 405),
          { Allow: "POST" },
        );
      }
      // The guessing limit is checked in the same step as the token, so guesses sent together
      // can't slip past it, and while it holds the right token is refused too (D97 item 8).
      const at = now();
      while (failures.length > 0 && (failures[0] as number) <= at - GUESS_WINDOW_MS)
        failures.shift();
      if (failures.length >= GUESS_LIMIT) {
        const retry = Math.max(
          1,
          Math.ceil(((failures[0] as number) + GUESS_WINDOW_MS - at) / 1000),
        );
        return refused(
          refusal("MOSTRA_HYGIENE_RATE_LIMITED", "Too many wrong tokens; try again shortly."),
          { "Retry-After": String(retry) },
        );
      }
      const authorizations = headers.filter(([name]) => name.toLowerCase() === "authorization");
      if (authorizations.length > 1) {
        return refused(
          refusal(
            "MOSTRA_HYGIENE_REQUEST_MALFORMED",
            "The request repeats the authorization header.",
          ),
        );
      }
      const authorization = authorizations[0]?.[1];
      if (authorization === undefined || !safeEqual(authorization, expected)) {
        if (authorization !== undefined) failures.push(at);
        return refused(
          refusal(
            "MOSTRA_HYGIENE_TOKEN_INVALID",
            authorization === undefined
              ? "The request has no Authorization header; send Authorization: Bearer <token>."
              : "The request's token isn't this server's.",
          ),
          { "WWW-Authenticate": 'Bearer realm="mostra"' },
        );
      }
      return harden(await handler.fetch(request));
    },
    close: () => handler.close(),
  };
}
