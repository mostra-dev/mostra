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

/** A page's sign-in in progress, kept in this tab only until its return (INTERFACES §18.4). */
interface PendingSignIn {
  readonly routeId: string;
  readonly verifier: string;
  readonly state: string;
  /** The authorization server's issuer, which the return's `iss` must equal (RFC 9207). */
  readonly issuer: string;
  /** The page to come back to, on this origin. */
  readonly back: string;
}

const SIGNIN_KEY = "mostra.signin";

/** A fresh PKCE pair (RFC 7636, S256): the verifier stays in this tab, the challenge travels. */
export async function pkcePair(): Promise<{
  readonly verifier: string;
  readonly challenge: string;
}> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64url(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  return { verifier, challenge: base64url(digest) };
}

function base64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Keeps a sign-in in progress; `false` when the tab can't keep it (sign-in then can't finish). */
export function keepSignIn(pending: PendingSignIn): boolean {
  try {
    globalThis.sessionStorage?.setItem(SIGNIN_KEY, JSON.stringify(pending));
    return globalThis.sessionStorage?.getItem(SIGNIN_KEY) !== null;
  } catch {
    return false;
  }
}

/** Takes the sign-in in progress, once: a second return finds nothing. */
export function takeSignIn(): PendingSignIn | undefined {
  try {
    const text = globalThis.sessionStorage?.getItem(SIGNIN_KEY) ?? null;
    globalThis.sessionStorage?.removeItem(SIGNIN_KEY);
    return text === null ? undefined : (JSON.parse(text) as PendingSignIn);
  } catch {
    return undefined;
  }
}

/** Whether this tab passed a route's interstitial already (D161): it is shown once per tab. */
export function interstitialPassed(routeId: string | undefined): boolean {
  if (routeId === undefined) return true;
  try {
    return globalThis.sessionStorage?.getItem(`mostra.passed.${routeId}`) === "1";
  } catch {
    return false;
  }
}

/** Notes that this tab passed a route's interstitial. */
export function passInterstitial(routeId: string | undefined): void {
  if (routeId === undefined) return;
  try {
    globalThis.sessionStorage?.setItem(`mostra.passed.${routeId}`, "1");
  } catch {
    // Not kept: the interstitial shows again at the next load, which is safe.
  }
}
