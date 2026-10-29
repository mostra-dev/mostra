/**
 * HTTP plumbing shared by the gateway's listeners: the headers every response carries (D98 item
 * 6, D98 item 4), refusal responses, cookies and JSON bodies. No policy lives here beyond the
 * response shapes; the checks themselves are `@mostra/protocol`'s `checkRequest` and the route
 * declarations in `routes.ts`.
 */
import type { IncomingMessage } from "node:http";
import type { HttpBindings } from "@hono/node-server";
import type { Diagnostic, Refusal } from "@mostra/protocol";
import { refusal } from "@mostra/protocol";

/** The Hono environment of a listener: Node's request and response objects. */
export type HttpEnv = { Bindings: HttpBindings };

/** The longest JSON body a gateway endpoint reads. */
export const MAX_JSON_BODY: number = 64 * 1024;

/** Headers on every gateway response (D98 item 6). */
export const BASE_HEADERS: Readonly<Record<string, string>> = {
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

/** A listener's identity, which decides its framing headers. */
export interface ListenerKind {
  readonly kind: "shell" | "artifact";
  /** The listener's own origin. */
  readonly origin: string;
  /** The shell's origin: the only page that may frame an artifact (D98 item 4). */
  readonly shellOrigin: string;
}

/**
 * The framing and content-security headers of a document: the shell is never framed, and its own
 * page loads only from itself; an artifact page may be framed by the shell alone. An artifact's
 * content is otherwise unrestricted (D05): only `frame-ancestors` is set.
 */
export function documentHeaders(
  listener: ListenerKind,
  frameOrigins: string,
): Record<string, string> {
  if (listener.kind === "shell") {
    return {
      "content-security-policy": [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        `frame-src ${frameOrigins}`,
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "object-src 'none'",
      ].join("; "),
      "x-frame-options": "DENY",
      // Popups the artifact frame opens get no opener, so none can navigate this page (D98
      // item 7): Firefox lets even a sandboxed popup navigate `opener.top`.
      "cross-origin-opener-policy": "same-origin",
    };
  }
  return { "content-security-policy": `frame-ancestors ${listener.shellOrigin}` };
}

/** Every header of a request as `[name, value]` pairs, repeats kept. */
export function headerPairs(incoming: IncomingMessage): [string, string][] {
  const pairs: [string, string][] = [];
  const raw = incoming.rawHeaders;
  for (let index = 0; index + 1 < raw.length; index += 2) {
    pairs.push([raw[index] as string, raw[index + 1] as string]);
  }
  return pairs;
}

/** The header the worker-mode service worker adds to a navigation it sends on (D70). */
export const NAVIGATION_HEADER = "x-mostra-navigation";

/** Whether a request is a navigation that should get an HTML page rather than JSON. */
export function wantsDocument(headers: Headers): boolean {
  // A worker-mode frame's navigation, which its service worker sends again as a plain request
  // (D70): the browser marks that one `Sec-Fetch-Dest: empty`.
  if (headers.get(NAVIGATION_HEADER) === "1") return true;
  const dest = headers.get("sec-fetch-dest");
  if (dest !== null) return dest === "document" || dest === "iframe" || dest === "frame";
  return (headers.get("accept") ?? "").includes("text/html");
}

/** Escapes text for HTML. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** A plain page for a refused navigation: no scripts, no external resources. */
function refusalPage(diagnostic: Diagnostic): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Mostra</title><style>body{font-family:system-ui,sans-serif;margin:0;min-height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:.25rem;padding:2rem;text-align:center;color-scheme:light dark}h1{font-size:1.25rem;margin:0}p{margin:0;opacity:.8}code{opacity:.5;font-size:.75rem;margin-top:1rem}</style></head><body><h1>${escapeHtml(diagnostic.message)}</h1>${diagnostic.hint ? `<p>${escapeHtml(diagnostic.hint)}</p>` : ""}<code>${escapeHtml(diagnostic.code)}</code></body></html>`;
}

/** The response for a refusal: the diagnostic as JSON, or a plain page for a navigation. */
export function refusalResponse(
  refused: Refusal & { readonly retryAfter?: number },
  options: {
    readonly document: boolean;
    readonly method?: string;
    readonly frameAncestors?: string;
  },
): Response {
  const headers: Record<string, string> = { ...BASE_HEADERS, "cache-control": "no-store" };
  if (refused.retryAfter !== undefined) headers["retry-after"] = String(refused.retryAfter);
  if (refused.status === 405) headers["allow"] = "GET, HEAD, POST";
  const head = options.method === "HEAD";
  if (options.document) {
    headers["content-type"] = "text/html; charset=utf-8";
    // The page has an inline style and nothing else; only the shell may frame it (on artifacts).
    headers["content-security-policy"] = [
      "default-src 'none'",
      "style-src 'unsafe-inline'",
      `frame-ancestors ${options.frameAncestors ?? "'none'"}`,
      "base-uri 'none'",
    ].join("; ");
    return new Response(head ? null : refusalPage(refused.diagnostic), {
      status: refused.status,
      headers,
    });
  }
  headers["content-type"] = "application/json; charset=utf-8";
  return new Response(head ? null : JSON.stringify(refused.diagnostic), {
    status: refused.status,
    headers,
  });
}

/** A JSON response with the base headers, never cached. */
export function jsonResponse(
  body: unknown,
  init: { readonly status?: number; readonly headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      ...BASE_HEADERS,
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

/** Every value of the cookie `name` in a `Cookie` header, in order (D98: there may be several). */
export function cookieValues(header: string | null, name: string): string[] {
  if (header === null) return [];
  const values: string[] = [];
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) values.push(part.slice(index + 1).trim());
  }
  return values;
}

/**
 * The `Set-Cookie` value of a session cookie (D98 item 1): never `Secure` over loopback HTTP,
 * always over a tunnel's HTTPS address (D158), where it must never travel in clear.
 */
export function sessionCookie(
  name: string,
  value: string,
  path: string,
  maxAgeSeconds: number,
  secure = false,
): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

/**
 * Reads a JSON object body of at most `maxBytes` (default {@link MAX_JSON_BODY}) bytes; a larger,
 * unreadable or non-object body is `MOSTRA_HYGIENE_REQUEST_MALFORMED`.
 */
export async function readJsonObject(
  request: Request,
  maxBytes: number = MAX_JSON_BODY,
): Promise<Record<string, unknown> | Refusal> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes) {
    return refusal(
      "MOSTRA_HYGIENE_REQUEST_MALFORMED",
      "The request body is larger than this endpoint reads.",
      413,
    );
  }
  let text: string;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = request.body?.getReader();
    for (;;) {
      if (!reader) break;
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      // A body sent without Content-Length is cut off as soon as it passes the limit.
      if (size > maxBytes) {
        await reader.cancel();
        return refusal(
          "MOSTRA_HYGIENE_REQUEST_MALFORMED",
          "The request body is larger than this endpoint reads.",
          413,
        );
      }
      chunks.push(value);
    }
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    return refusal(
      "MOSTRA_HYGIENE_REQUEST_MALFORMED",
      "The request body couldn't be read as UTF-8.",
    );
  }
  try {
    const value: unknown = text === "" ? {} : JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return refusal("MOSTRA_HYGIENE_REQUEST_MALFORMED", "The request body must be a JSON object.");
    }
    return value as Record<string, unknown>;
  } catch {
    return refusal("MOSTRA_HYGIENE_REQUEST_MALFORMED", "The request body isn't valid JSON.");
  }
}

/** Whether a value is a {@link Refusal}. */
export function isRefusal(value: unknown): value is Refusal {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    "diagnostic" in value &&
    typeof (value as { status: unknown }).status === "number"
  );
}
