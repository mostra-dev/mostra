/**
 * The shell's calls to its gateway (D98): exchange the link's token for a session, read the
 * session, and get a single-use frame ticket. Every call is same-origin JSON; mutations carry the
 * session's CSRF token.
 */

/** What a link allows. */
export interface Access {
  /** Its scopes (D97). */
  readonly scopes: readonly string[];
  /** When it stops working, if it does. */
  readonly expiresAt?: string;
  /** The one version it opens, if it names one. */
  readonly version?: number;
}

/** What the shell's session knows about its artifact. */
export interface ShellSession extends Access {
  /** The session's CSRF token, sent with every mutation. */
  readonly csrf: string;
  /** The artifact the session's link opens. */
  readonly artifact: { readonly id: string; readonly title: string };
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
  /** The refusal's body, for codes that carry more than a diagnostic. */
  readonly body: unknown;
  constructor(status: number, code: string, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** The codes of answers that aren't JSON, by status. */
const STATUS_CODES: Readonly<Record<number, string>> = {
  431: "MOSTRA_HYGIENE_HEADERS_TOO_LARGE",
};

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const diagnostic = (body ?? {}) as { code?: string; message?: string };
    throw new ShellError(
      response.status,
      diagnostic.code ?? STATUS_CODES[response.status] ?? "MOSTRA_HOST_INTERNAL_ERROR",
      diagnostic.message ?? `The gateway answered ${response.status}.`,
      body,
    );
  }
  return body as T;
}

const JSON_HEADERS = { "content-type": "application/json" };

/** Two links met: what the session has and what the opened link offers. */
export interface Conflict {
  readonly current: Access;
  readonly offered: Access;
}

/**
 * Exchanges the link's capability token for a session cookie. When this browser already has a
 * session from another link, the gateway answers `MOSTRA_HYGIENE_SESSION_CONFLICT` (a
 * {@link ShellError} whose body is a {@link Conflict}) unless `replace` is set (D98 item 8).
 */
export function exchange(apiBase: string, token: string, replace = false): Promise<ShellSession> {
  return call(`${apiBase}/session`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(replace ? { token, replace: true } : { token }),
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
