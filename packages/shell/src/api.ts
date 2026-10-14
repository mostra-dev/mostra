/**
 * The shell's calls to its gateway (D98): exchange the link's token for a session, read the
 * session, and get a single-use frame ticket. Every call is same-origin JSON; mutations carry the
 * session's CSRF token.
 */

/** What the shell's session knows about its artifact. */
export interface ShellSession {
  /** The session's CSRF token, sent with every mutation. */
  readonly csrf: string;
  /** The artifact the session's link opens. */
  readonly artifact: { readonly id: string; readonly title: string };
  /** What the link allows. */
  readonly scopes: readonly string[];
  /** When the link stops working, if it does. */
  readonly expiresAt?: string;
}

/** A frame ticket and where to use it. */
export interface FrameTicket {
  /** The frame's entry URL, carrying the single-use ticket. */
  readonly src: string;
  /** The artifact's origin: the only origin the bridge accepts messages from. */
  readonly artifactOrigin: string;
  /** The version the frame will show. */
  readonly version: { readonly id: string; readonly number: number };
  /** The artifact's latest version. */
  readonly latest: { readonly number: number };
}

/** A refusal from the gateway, with its diagnostic code. */
export class ShellError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const diagnostic = (body ?? {}) as { code?: string; message?: string };
    throw new ShellError(
      response.status,
      diagnostic.code ?? "MOSTRA_HOST_INTERNAL_ERROR",
      diagnostic.message ?? `The gateway answered ${response.status}.`,
    );
  }
  return body as T;
}

const JSON_HEADERS = { "content-type": "application/json" };

/** Exchanges the link's capability token for a session cookie. */
export function exchange(apiBase: string, token: string): Promise<ShellSession> {
  return call(`${apiBase}/session`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ token }),
  });
}

/** Reads the session the browser already has for this artifact. */
export function readSession(apiBase: string): Promise<ShellSession> {
  return call(`${apiBase}/session`, { method: "GET" });
}

/** Gets a single-use ticket for the artifact's frame, for a pinned version or the latest. */
export function frameTicket(apiBase: string, csrf: string, version?: number): Promise<FrameTicket> {
  return call(`${apiBase}/ticket`, {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-mostra-csrf": csrf },
    body: JSON.stringify(version === undefined ? {} : { version }),
  });
}
