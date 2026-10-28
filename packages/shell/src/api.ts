/**
 * The shell's calls to its gateway (D98): exchange the link's token for a session, read the
 * session, get a single-use frame ticket, and the trusted controls' routes (WP-07): Submit,
 * Choose, follow and what a version carries over. Every call is same-origin JSON; mutations carry
 * the session's CSRF token, which only this page can read.
 */

import {
  BROWSER_PROTOCOL_REVISION,
  type CarryOver,
  type FrameTicket,
  MutationId,
  type MutationResult,
  type SubmissionSummary,
} from "@mostra/protocol";
import type { Credential } from "./location.ts";

export type { FrameTicket } from "@mostra/protocol";

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
  let response: Response;
  try {
    response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init });
  } catch (error) {
    throw new ShellError(0, "NETWORK", (error as Error).message);
  }
  // An answer whose body can't be read (the request aborted mid-body, the connection lost) fails
  // like the request; only an empty or unparseable body of a refusal reads as nothing. Before, a
  // body cut off resolved `undefined` as if it were the answer (the second GPT review of MT-02b).
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    throw new ShellError(0, "NETWORK", (error as Error).message);
  }
  let body: unknown;
  try {
    body = text === "" ? undefined : JSON.parse(text);
  } catch {
    if (response.ok)
      throw new ShellError(
        response.status,
        "MOSTRA_HOST_INTERNAL_ERROR",
        "The gateway's answer wasn't JSON.",
      );
    body = undefined;
  }
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
 * Exchanges the link's capability token, or a one-time launch ticket (D140), for a session cookie. When this browser already has a
 * session from another link, the gateway answers `MOSTRA_HYGIENE_SESSION_CONFLICT` (a
 * {@link ShellError} whose body is a {@link Conflict}) unless `replace` is set (D98 item 8).
 */
export function exchange(
  apiBase: string,
  credential: Credential,
  replace = false,
): Promise<ShellSession> {
  const browser = browserKey();
  return call(`${apiBase}/session`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      ...credential,
      ...(browser !== undefined ? { browser } : {}),
      ...(replace ? { replace: true } : {}),
    }),
  });
}

const BROWSER_KEY = "mostra.browser";

/**
 * This browser's key on the shell's origin: random, kept in the origin's storage, the same for
 * every tab. The gateway uses it to tell two exchanges of one browser apart from two browsers, so
 * a link opened while another link's exchange waits is never silently replaced (D98 item 8, Opus
 * review of WP-12, finding 2). No other origin can read it; it grants nothing.
 */
export function browserKey(): string | undefined {
  try {
    const stored = globalThis.localStorage?.getItem(BROWSER_KEY);
    if (stored && /^[A-Za-z0-9_-]{16,64}$/.test(stored)) return stored;
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    const key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    globalThis.localStorage?.setItem(BROWSER_KEY, key);
    return key;
  } catch {
    // Storage blocked: the gateway's cookie check alone applies, as before.
    return undefined;
  }
}

/** Reads the session the browser already has for this artifact. */
export function readSession(apiBase: string): Promise<ShellSession> {
  return call(`${apiBase}/session`, { method: "GET" });
}

/**
 * Gets a single-use ticket for the artifact's frame, for a pinned version or the latest; `signal`
 * ends the request, which then fails as a network error.
 */
export function frameTicket(
  apiBase: string,
  csrf: string,
  version?: number,
  signal?: AbortSignal,
): Promise<FrameTicket> {
  return call(`${apiBase}/ticket`, {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-mostra-csrf": csrf },
    body: JSON.stringify(version === undefined ? {} : { version }),
    ...(signal ? { signal } : {}),
  });
}

/** One of the shell's routes of the browser protocol, under its artifact's API base. */
function shellRoute(apiBase: string, path: string): string {
  return `${apiBase}/v/${BROWSER_PROTOCOL_REVISION}${path}`;
}

/** The URL of the shell's own event stream for a view, or of its long poll. */
export function eventsUrl(apiBase: string, viewId: string, poll = false): string {
  return shellRoute(
    apiBase,
    (poll ? "/events/poll?view=" : "/events?view=") + encodeURIComponent(viewId),
  );
}

/** The trusted Submit: the `shell` channel (D40), for the revision the viewer saw. */
export function submit(
  apiBase: string,
  csrf: string,
  viewId: string,
  expectedRevision: string,
): Promise<SubmissionSummary> {
  return call(shellRoute(apiBase, "/submit"), {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-mostra-csrf": csrf },
    body: JSON.stringify({ viewId, expectedRevision }),
  });
}

/** The trusted Choose (D113): the viewer's choice of a review set's candidate. */
export function choose(
  apiBase: string,
  csrf: string,
  input: {
    readonly viewId: string;
    readonly baseRevision: string;
    readonly reviewSetId: string;
    readonly candidateId: string;
    readonly label?: string;
  },
): Promise<MutationResult> {
  return call(shellRoute(apiBase, "/review/choose"), {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-mostra-csrf": csrf },
    body: JSON.stringify({ ...input, mutationId: MutationId.create() }),
  });
}

/** "Always follow this artifact" on or off (D63). */
export function setFollow(apiBase: string, csrf: string, follow: boolean): Promise<unknown> {
  return call(shellRoute(apiBase, "/follow"), {
    method: "POST",
    headers: { ...JSON_HEADERS, "x-mostra-csrf": csrf },
    body: JSON.stringify({ follow }),
  });
}

/** The viewer's answers a version doesn't carry over (D42). */
export function carryOver(apiBase: string, version: number): Promise<CarryOver> {
  return call(shellRoute(apiBase, `/carry?version=${String(version)}`), { method: "GET" });
}
