/**
 * Request hygiene (D06, ARCHITECTURE §10, HY-01): the checks every Mostra HTTP endpoint applies
 * before it acts on a request, as pure functions with no I/O. The gateway runs them on every
 * request, and `mostra mcp --http` (WP-15) runs the same code (D96), so a request a stranger's
 * page could send is refused the same way everywhere. None of them limits what an artifact, an
 * agent or a viewer may do; they only make sure a request comes from the page it claims to.
 *
 * ```ts
 * const refusal = checkRequest(
 *   { origin: "http://127.0.0.1:23456", hosts: ["127.0.0.1:23456"] },
 *   { method: "POST", target: "/a/art_…/_mostra/ticket", headers, intent: "mutation", csrf },
 * );
 * if (refusal) return respond(refusal.status, refusal.diagnostic);
 * ```
 */
import { type HygieneDiagnosticCode, hygieneDiagnostics } from "./diagnostics/codes/hygiene.ts";
import type { Diagnostic } from "./diagnostics/diagnostic.ts";
import { buildDiagnostic } from "./diagnostics/spec.ts";

/** What one listener serves: its own origin and the exact `Host` values it accepts. */
export interface RequestPolicy {
  /** The listener's origin, such as `http://127.0.0.1:23456`; `Origin` headers must equal it. */
  readonly origin: string;
  /** Every `host:port` this listener answers to (lowercase): its URL host, plus registered tunnels. */
  readonly hosts: readonly string[];
}

/**
 * What a request is for, which decides the checks beyond the envelope:
 * - `read`: a GET or HEAD of a page or file; a foreign `Origin` is refused, none is fine.
 * - `stream`: an event stream (GET); same-origin only, by `Origin` or `Sec-Fetch-Site`.
 * - `upgrade`: a WebSocket upgrade; `Origin` must be present and equal.
 * - `exchange`: a mutation that starts a session (a capability token or ticket in the body):
 *   `Origin` and a JSON content type, but no CSRF token yet.
 * - `mutation`: any other state change: `Origin`, a JSON content type and the session's CSRF
 *   token in `X-Mostra-CSRF`.
 */
export type RequestIntent = "read" | "stream" | "upgrade" | "exchange" | "mutation";

/** One request as the transport received it. */
export interface RequestFacts {
  /** The method, as sent. */
  readonly method: string;
  /** The request target exactly as sent: an origin-form path with its query. */
  readonly target: string;
  /** Every header as `[name, value]` in arrival order, so repeated headers are visible. */
  readonly headers: readonly (readonly [string, string])[];
  /** The intent the matched route declared; omit to check only the envelope. */
  readonly intent?: RequestIntent;
  /** The session's CSRF token, for `mutation` requests. */
  readonly csrf?: string;
}

/** A refused request: the HTTP status to answer with and the diagnostic for its body. */
export interface Refusal {
  /** The HTTP status: 400, 401, 403, 404, 410, 415, 421 or 429. */
  readonly status: number;
  /** What was refused and why, for the response body and the log. */
  readonly diagnostic: Diagnostic;
}

/** The header that carries a session's CSRF token on every mutation (D98). */
export const CSRF_HEADER = "x-mostra-csrf";

const STATUS: Readonly<Record<HygieneDiagnosticCode, number>> = {
  MOSTRA_HYGIENE_HOST_REFUSED: 421,
  MOSTRA_HYGIENE_ORIGIN_REFUSED: 403,
  MOSTRA_HYGIENE_CSRF_MISSING: 403,
  MOSTRA_HYGIENE_CONTENT_TYPE: 415,
  MOSTRA_HYGIENE_REQUEST_MALFORMED: 400,
  MOSTRA_HYGIENE_SESSION_MISSING: 401,
  MOSTRA_HYGIENE_TOKEN_INVALID: 401,
  MOSTRA_HYGIENE_TOKEN_REVOKED: 410,
  MOSTRA_HYGIENE_SCOPE_DENIED: 403,
  MOSTRA_HYGIENE_RATE_LIMITED: 429,
  MOSTRA_HYGIENE_NOT_SERVED: 404,
};

/** Builds a refusal with the status the code's HTTP mapping gives (FAILURE_MODEL §8). */
export function refusal(code: HygieneDiagnosticCode, message: string, status?: number): Refusal {
  return {
    status: status ?? STATUS[code],
    diagnostic: buildDiagnostic(code, hygieneDiagnostics[code], { message }),
  };
}

/** Headers that must appear at most once: a second copy could mean two different things. */
const SINGLE = new Set(["host", "origin", "content-type", "content-length", CSRF_HEADER, "cookie"]);

/** Characters no header value or path may carry: controls other than tab, and DEL. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f]/;

/** Constant-time comparison of two strings, so timing reveals nothing about a secret. */
export function safeEqual(a: string, b: string): boolean {
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    difference |= (a.charCodeAt(index) | 0) ^ (b.charCodeAt(index) | 0);
  }
  return difference === 0;
}

/**
 * The path a request target names, decoded, or `undefined` when it isn't a safe origin-form path:
 * absolute and authority forms, `*`, encoded `/` or `\`, `.` or `..` segments (encoded or not),
 * NUL and other controls, and invalid percent-encoding are all refused.
 */
export function safePath(target: string): string | undefined {
  if (!target.startsWith("/") || target.startsWith("//")) return undefined;
  const end = target.search(/[?#]/);
  const raw = end < 0 ? target : target.slice(0, end);
  if (/%(2f|5c)/i.test(raw) || raw.includes("\\")) return undefined;
  let path: string;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  if (CONTROL.test(path) || path.includes("\u0000")) return undefined;
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return undefined;
  return path;
}

/** The value of a header (case-insensitive name), or `undefined`. */
export function headerValue(
  headers: readonly (readonly [string, string])[],
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  return headers.find(([key]) => key.toLowerCase() === lower)?.[1];
}

/** Whether a `Content-Type` value is JSON (`application/json`, any parameters). */
export function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  return value.split(";")[0]?.trim().toLowerCase() === "application/json";
}

/**
 * Checks a request's envelope (the `Host` allowlist, the request target, repeated and malformed
 * headers) and, when `intent` is given, what that intent needs: `Origin`, the JSON content type
 * and the CSRF token. Returns the first refusal, or `undefined` when the request may proceed.
 * Session, token and scope checks follow in the endpoint, which knows its session.
 */
export function checkRequest(policy: RequestPolicy, request: RequestFacts): Refusal | undefined {
  const counts = new Map<string, number>();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    counts.set(lower, (counts.get(lower) ?? 0) + 1);
    if (CONTROL.test(value)) {
      return refusal(
        "MOSTRA_HYGIENE_REQUEST_MALFORMED",
        `The ${lower} header has control characters.`,
      );
    }
  }
  for (const name of SINGLE) {
    if ((counts.get(name) ?? 0) > 1) {
      return refusal("MOSTRA_HYGIENE_REQUEST_MALFORMED", `The request repeats the ${name} header.`);
    }
  }
  const host = headerValue(request.headers, "host")?.toLowerCase();
  if (host === undefined || !policy.hosts.includes(host)) {
    return refusal(
      "MOSTRA_HYGIENE_HOST_REFUSED",
      host === undefined
        ? "The request has no Host header."
        : "The request's Host isn't one this listener serves.",
    );
  }
  if (safePath(request.target) === undefined) {
    return refusal(
      "MOSTRA_HYGIENE_REQUEST_MALFORMED",
      "The request target isn't a plain path inside the served tree.",
    );
  }
  if (request.intent === undefined) return undefined;

  const origin = headerValue(request.headers, "origin");
  switch (request.intent) {
    case "read":
      if (origin !== undefined && origin !== policy.origin) {
        return refusal("MOSTRA_HYGIENE_ORIGIN_REFUSED", "The request came from another origin.");
      }
      return undefined;
    case "stream": {
      const site = headerValue(request.headers, "sec-fetch-site");
      const sameOrigin = origin === undefined ? site === "same-origin" : origin === policy.origin;
      return sameOrigin
        ? undefined
        : refusal("MOSTRA_HYGIENE_ORIGIN_REFUSED", "A stream must be opened by its own origin.");
    }
    case "upgrade":
    case "exchange":
    case "mutation": {
      if (origin !== policy.origin) {
        return refusal(
          "MOSTRA_HYGIENE_ORIGIN_REFUSED",
          origin === undefined
            ? "The request has no Origin header."
            : "The request came from another origin.",
        );
      }
      if (request.intent === "upgrade") return undefined;
      if (!isJsonContentType(headerValue(request.headers, "content-type"))) {
        return refusal("MOSTRA_HYGIENE_CONTENT_TYPE", "The request's body isn't declared as JSON.");
      }
      if (request.intent === "exchange") return undefined;
      const sent = headerValue(request.headers, CSRF_HEADER);
      if (request.csrf === undefined || sent === undefined || !safeEqual(sent, request.csrf)) {
        return refusal(
          "MOSTRA_HYGIENE_CSRF_MISSING",
          sent === undefined
            ? `The request has no ${CSRF_HEADER} header.`
            : `The request's ${CSRF_HEADER} header doesn't match its session.`,
        );
      }
      return undefined;
    }
  }
}
