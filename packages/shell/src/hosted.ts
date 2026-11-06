/**
 * The hosted shell's session (INTERFACES §18.4, D165 item 8). On a remote server no cookie is ever
 * set or read: the shell keeps its session's secret in its own origin's storage, one per route,
 * and sends it as `X-Mostra-Shell` on every request for that route. Tenant pages share the apex's
 * site, so a cookie could be tossed, shadowed or crowded out by any of them; a header can't.
 *
 * When storage fails (a sibling page filled the site's group, or storage is blocked), the secret
 * stays in memory for this page's life and the link's fragment stays in the address bar until it
 * is stored, so a reload still has the link.
 */
import { SHELL_SESSION_HEADER } from "@mostra/protocol";

const SESSION_KEY = (routeId: string): string => `mostra.session.${routeId}`;
const BROWSER_SECRET_KEY = "mostra.browser-secret";

let current: { readonly routeId: string; secret: string | undefined } | undefined;

/** Starts the hosted mode for a route: the shell's requests carry that route's session. */
export function enterRoute(routeId: string): void {
  let secret: string | undefined;
  try {
    secret = globalThis.localStorage?.getItem(SESSION_KEY(routeId)) ?? undefined;
  } catch {
    secret = undefined;
  }
  current = {
    routeId,
    secret: secret !== undefined && looksLikeSecret(secret) ? secret : undefined,
  };
}

/** Whether the shell is a hosted one. */
export function hosted(): boolean {
  return current !== undefined;
}

/** The headers a request of the hosted shell carries: its route's session, once it has one. */
export function sessionHeaders(): Record<string, string> {
  return current?.secret !== undefined ? { [SHELL_SESSION_HEADER]: current.secret } : {};
}

/**
 * Keeps the session's secret the exchange answered: in memory at once, and in storage when it
 * can be. Answers whether it was stored, so the caller leaves the link's fragment in place when
 * it wasn't.
 */
export function keepSession(secret: string): boolean {
  if (!current) return false;
  current.secret = secret;
  try {
    globalThis.localStorage?.setItem(SESSION_KEY(current.routeId), secret);
    return globalThis.localStorage?.getItem(SESSION_KEY(current.routeId)) === secret;
  } catch {
    return false;
  }
}

/** Forgets the route's session (its link was revoked): the next open needs the link again. */
export function forgetSession(): void {
  if (!current) return;
  current.secret = undefined;
  try {
    globalThis.localStorage?.removeItem(SESSION_KEY(current.routeId));
  } catch {
    // Nothing kept: nothing to forget.
  }
}

/**
 * This browser's key for a route: `HMAC-SHA-256(browser secret, routeId)`, so two routes, and two
 * owners, never see one key for the same browser (INTERFACES §18.4). The raw secret never leaves
 * this origin's storage. `undefined` where storage or Web Crypto isn't available.
 */
export async function routeBrowserKey(routeId: string): Promise<string | undefined> {
  try {
    const storage = globalThis.localStorage;
    let secret = storage?.getItem(BROWSER_SECRET_KEY) ?? null;
    if (secret === null || !/^[0-9a-f]{64}$/.test(secret)) {
      const bytes = new Uint8Array(32);
      globalThis.crypto.getRandomValues(bytes);
      secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      storage?.setItem(BROWSER_SECRET_KEY, secret);
    }
    const subtle = globalThis.crypto.subtle;
    const key = await subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = new Uint8Array(await subtle.sign("HMAC", key, new TextEncoder().encode(routeId)));
    // base64url, 43 characters: inside the gateway's browser-key pattern.
    let text = "";
    for (const byte of mac) text += String.fromCharCode(byte);
    return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  } catch {
    return undefined;
  }
}

/** A session secret's shape: 26 Crockford base32 characters (D98). */
function looksLikeSecret(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}
