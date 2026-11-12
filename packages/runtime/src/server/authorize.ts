/**
 * The authorization server's pages on the API origin (INTERFACES §18.5, D165 items 8, 10):
 *
 * - `GET /oauth/authorize`: the authorization code flow with PKCE (S256) for MCP clients (Client
 *   ID Metadata Documents, registered clients) and for each hosted shell's viewer sign-in. The
 *   client and its redirect URI are checked before anything is redirected anywhere; an `iss`
 *   parameter goes with every answer (RFC 9207).
 * - Sign-in through an identity provider (`/signin/<id>/start`, its `callback`), into a browser
 *   session on the API origin only, never the user-content domain; the operator's first sign-in
 *   steps (`/signin/return`).
 * - The server's own consent page (`/oauth/consent`), for every client an account hasn't
 *   approved, never skipped because a provider skipped its own; for a page's sign-in it names
 *   the page's sender instead, once per account and home.
 *
 * Every in-progress record (an authorization request, a provider sign-in, a first sign-in step)
 * is kept only as the SHA-256 of its handle, lives minutes, is used once, and is bound to the
 * browser that started it by a cookie of the API origin.
 */
import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type IdentityProvider,
  type SignInIdentity,
  SignInIdentity as SignInIdentitySchema,
} from "@mostra/protocol/operator";
import type { Ledger } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import { type Authorization, canonicalResource, hashSecret } from "./auth.ts";
import { verifierLabel } from "./config.ts";
import { type Clients, type OAuthClient, redirectAllowed } from "./oauth-clients.ts";
import type { Operator } from "./operator.ts";

/** How long an authorization request, a provider sign-in or a step waits. */
const PENDING_MS = 15 * 60_000;
/** How long a browser stays signed in to the API origin. */
const SESSION_MS = 7 * 24 * 60 * 60_000;
/** At most this many first sign-in steps per sign-in (D167). */
const MAX_STEPS = 3;
/**
 * How long an identity provider's own calls may take (its authorization address, the code's
 * exchange): inside the 10 s every endpoint of the authorization server answers in (D165 item 10),
 * whether the provider is built in or the operator's.
 */
const PROVIDER_MS = 8_000;

/** A provider's call, or a refusal once it took longer than {@link PROVIDER_MS}. */
async function bounded<T>(call: () => Promise<T> | T, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(call),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} took too long`)), PROVIDER_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** What the pages need. */
export interface AuthorizeOptions {
  readonly apiOrigin: string;
  readonly directory: Ledger;
  readonly auth: Authorization;
  readonly clients: Clients;
  readonly operator: Operator;
  /** The built-in providers (configuration); the operator's join them at each sign-in. */
  readonly providers: readonly IdentityProvider[];
  /** Names a hosted home's owner, for a page's sign-in ("Grace Hopper's page"). */
  readonly ownerName: (homeId: string) => string | undefined;
  readonly log: Log;
  readonly now?: () => number;
}

/** A page's sign-in in progress (INTERFACES §18.4), bound to its route and shell session. */
export interface ViewerSignin {
  readonly homeId: string;
  readonly routeId: string;
  readonly sessionId: string;
  readonly shellOrigin: string;
}

/** The pages. */
export interface Authorize {
  /** Serves a request of the API origin when it is one of these pages; `false` otherwise. */
  handle(request: IncomingMessage, response: ServerResponse, path: string): Promise<boolean>;
  /**
   * Starts a page's sign-in from its shell (a click in the trusted chrome): the address the shell
   * sends the person to, with `state` bound to the route and the shell session.
   */
  startViewerSignin(
    signin: ViewerSignin,
    challenge: string,
  ): { readonly url: string; readonly state: string };
  /** Finishes a page's sign-in: the code, for the same route and session only. */
  finishViewerSignin(input: {
    readonly state: string;
    readonly code: string;
    readonly verifier: string;
    readonly routeId: string;
    readonly sessionId: string;
  }):
    | { readonly accountId: string; readonly name?: string; readonly provider?: string }
    | { readonly refused: string };
  /** The browser session's account of a request to the API origin, if signed in. */
  sessionAccount(
    request: IncomingMessage,
  ): { readonly accountId: string; readonly hash: string } | undefined;
  /** A CSRF token for a signed-in browser's form. */
  csrf(sessionHash: string, purpose: string): string;
  /** The providers a sign-in may use now: configured ones, then the operator's. */
  providers(): Promise<readonly { readonly id: string; readonly label: string }[]>;
  /** Starts a sign-in whose end continues at a page of the API origin (the device page). */
  signInPage(response: ServerResponse, next: string, message?: string): Promise<void>;
}

const BASE = {
  "cache-control": "no-store",
  "cross-origin-resource-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem}
input{font:inherit;padding:.3rem}button,a.button{font:inherit;padding:.4rem .9rem;margin:.2rem .5rem .2rem 0;display:inline-block}
.muted{color:#555}</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}

/** Builds the pages. */
export function createAuthorize(options: AuthorizeOptions): Authorize {
  const { apiOrigin, directory, auth, clients, operator, log } = options;
  const now = options.now ?? (() => Date.now());
  const secure = apiOrigin.startsWith("https:");
  const sessionCookie = secure ? "__Host-mostra-signin" : "mostra-signin";
  const flowCookie = secure ? "__Host-mostra-flow" : "mostra-flow";
  const iso = (ms: number) => new Date(ms).toISOString();
  const token = () => randomBytes(32).toString("base64url");

  const cookies = (request: IncomingMessage): Map<string, string> => {
    const found = new Map<string, string>();
    for (const part of (request.headers.cookie ?? "").split(";")) {
      const at = part.indexOf("=");
      if (at <= 0) continue;
      const name = part.slice(0, at).trim();
      // A repeated name is ambiguous: the first is kept, as browsers send the most specific first.
      if (!found.has(name)) found.set(name, part.slice(at + 1).trim());
    }
    return found;
  };
  const setCookie = (name: string, value: string, maxAgeS: number): string =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure ? "; Secure" : ""}`;

  const send = (
    response: ServerResponse,
    status: number,
    html: string,
    extra: Record<string, string | string[]> = {},
    formTargets: readonly string[] = [],
  ): void => {
    response.writeHead(status, {
      ...BASE,
      "content-type": "text/html; charset=utf-8",
      // A form posts here, and its answer may redirect to a client: those origins only.
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${formTargets.join(" ")}; frame-ancestors 'none'; base-uri 'none'`,
      // A form's POST must carry this page's Origin (D166 item 10).
      "referrer-policy": "same-origin",
      ...extra,
    });
    response.end(html);
  };
  const redirect = (
    response: ServerResponse,
    location: string,
    extra: Record<string, string | string[]> = {},
  ): void => {
    response.writeHead(303, { ...BASE, location, "referrer-policy": "no-referrer", ...extra });
    response.end();
  };
  const problem = (response: ServerResponse, status: number, message: string): void =>
    send(
      response,
      status,
      shell("Sign-in can't continue", `<p role="alert">${escapeHtml(message)}</p>`),
    );

  // ── in-progress records ─────────────────────────────────────────────────────────────────

  const keep = (kind: "provider" | "step" | "authorize", handle: string, data: unknown): void =>
    directory.write((db) => {
      db.run("DELETE FROM signin WHERE expires_at < ?", iso(now()));
      db.run(
        "INSERT INTO signin (hash, kind, data_json, expires_at) VALUES (?, ?, ?, ?)",
        hashSecret(handle),
        kind,
        JSON.stringify(data),
        iso(now() + PENDING_MS),
      );
    });
  const read = <T>(kind: "provider" | "step" | "authorize", handle: string): T | undefined =>
    directory.read((db) => {
      const row = db.get<{ data_json: string; expires_at: string }>(
        "SELECT data_json, expires_at FROM signin WHERE hash = ? AND kind = ?",
        hashSecret(handle),
        kind,
      );
      return row && Date.parse(row.expires_at) > now()
        ? (JSON.parse(row.data_json) as T)
        : undefined;
    });
  const spend = (handle: string): boolean =>
    directory.write(
      (db) => db.run("DELETE FROM signin WHERE hash = ?", hashSecret(handle)).changes > 0,
    );

  // ── browser sessions ────────────────────────────────────────────────────────────────────

  const sessionAccount = (request: IncomingMessage) => {
    const value = cookies(request).get(sessionCookie);
    if (value === undefined || !/^[A-Za-z0-9_-]{43}$/.test(value)) return undefined;
    const hash = hashSecret(value);
    const row = directory.read((db) =>
      db.get<{ account_id: string; expires_at: string; status: string }>(
        `SELECT s.account_id, s.expires_at, a.status FROM browser_session s
           JOIN account a ON a.id = s.account_id WHERE s.hash = ?`,
        hash,
      ),
    );
    if (!row || Date.parse(row.expires_at) <= now() || row.status !== "active") return undefined;
    return { accountId: row.account_id, hash };
  };
  const startSession = (accountId: string): string => {
    const value = token();
    directory.write((db) =>
      db.run(
        "INSERT INTO browser_session (hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        hashSecret(value),
        accountId,
        iso(now()),
        iso(now() + SESSION_MS),
      ),
    );
    return setCookie(sessionCookie, value, Math.floor(SESSION_MS / 1000));
  };
  const csrf = (sessionHash: string, purpose: string): string =>
    createHash("sha256").update(`mostra csrf ${sessionHash} ${purpose}`).digest("base64url");

  // ── providers ───────────────────────────────────────────────────────────────────────────

  /**
   * The label a provider's verified names carry (`IdentityProvider.verifies`, MT-03): text of 1 to
   * 64 characters, else none, since an operator's provider is checked as every operator answer is.
   */
  const verifierOf = (provider: IdentityProvider): string | undefined => {
    const raw: unknown = (provider as { verifies?: { label?: unknown } }).verifies?.label;
    const label = verifierLabel(raw);
    if (label === undefined && provider.verifies !== undefined) {
      log.warn("signin.verifier_refused", { provider: provider.id });
    }
    return label;
  };

  /** The providers now: configured ones, then the operator's (asked each time, D167). */
  const providers = async (): Promise<IdentityProvider[]> => {
    const supplied = await operator.providers();
    const ids = new Set(options.providers.map((provider) => provider.id));
    return [...options.providers, ...supplied.filter((provider) => !ids.has(provider.id))];
  };

  interface ProviderRecord {
    readonly provider: string;
    readonly verifier: string;
    readonly challenge: string;
    readonly nonce: string;
    readonly flow: string;
    readonly next: string;
  }
  interface StepRecord {
    readonly identity: SignInIdentity;
    /** The verifier label of the provider that named the person (MT-03). */
    readonly verifiedBy?: string;
    readonly steps: number;
    readonly flow: string;
    readonly next: string;
  }

  /** The page listing the providers; each starts a sign-in that returns to `next`. */
  const signInPage = async (
    response: ServerResponse,
    next: string,
    message?: string,
  ): Promise<void> => {
    const list = await providers();
    const links = list
      .map(
        (provider) =>
          `<p><a class="button" href="/signin/${encodeURIComponent(provider.id)}/start?next=${encodeURIComponent(next)}">Continue with ${escapeHtml(provider.label)}</a></p>`,
      )
      .join("");
    send(
      response,
      200,
      shell(
        "Sign in to Mostra",
        `${message ? `<p role="alert">${escapeHtml(message)}</p>` : ""}${links || "<p>This server has no identity provider configured, so nobody can sign in yet.</p>"}`,
      ),
    );
  };

  /** Where a finished sign-in continues: an address of the API origin only. */
  const safeNext = (next: string | null): string =>
    next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  /** A resolved identity: a session and on to `next`, a step, or why not. */
  const resolved = async (
    response: ServerResponse,
    identity: SignInIdentity,
    verifiedBy: string | undefined,
    steps: number,
    flow: string,
    next: string,
  ): Promise<void> => {
    const account = await auth.resolveAccount(identity, steps, verifiedBy);
    if (account.kind === "unavailable") {
      problem(response, 503, "Sign-in is unavailable for a moment; try again shortly.");
      return;
    }
    if (account.kind === "refused") {
      problem(response, 403, account.message);
      return;
    }
    if (account.kind === "suspended") {
      problem(response, 403, "This account is suspended.");
      return;
    }
    if (account.kind === "step") {
      if (steps >= MAX_STEPS) {
        problem(response, 403, "Sign-in asked for too many steps; try again later.");
        return;
      }
      const handle = token();
      keep("step", handle, {
        identity,
        ...(verifiedBy !== undefined ? { verifiedBy } : {}),
        steps: steps + 1,
        flow,
        next,
      } satisfies StepRecord);
      const url = new URL(account.url);
      url.searchParams.set("mostra_return", `${apiOrigin}/signin/return?step=${handle}`);
      redirect(response, url.href);
      return;
    }
    log.info("signin.done", { provider: identity.provider });
    redirect(response, `${apiOrigin}${safeNext(next)}`, {
      "set-cookie": [startSession(account.accountId), setCookie(flowCookie, "", 0)],
    });
  };

  // ── authorization requests ──────────────────────────────────────────────────────────────

  interface AuthorizeRecord {
    readonly clientId: string;
    readonly redirectUri: string;
    readonly state: string | null;
    readonly challenge: string;
    readonly resource: string;
    readonly scope: string;
    readonly viewerSignin?: string;
    readonly redirectGiven: boolean;
  }
  interface ViewerSigninRecord extends ViewerSignin {
    readonly clientId: string;
  }

  /** The answer to a client's redirect URI, with `iss` (RFC 9207). */
  const toClient = (
    response: ServerResponse,
    redirectUri: string,
    params: Record<string, string | null>,
  ): void => {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(params))
      if (value !== null) url.searchParams.set(key, value);
    url.searchParams.set("iss", apiOrigin);
    redirect(response, url.href);
  };

  /** Consent, or the code: a signed-in account continuing an authorization request. */
  const proceed = async (
    request: IncomingMessage,
    response: ServerResponse,
    handle: string,
    signed: { accountId: string; hash: string },
  ): Promise<void> => {
    const pending = read<AuthorizeRecord>("authorize", handle);
    if (!pending) {
      problem(response, 400, "This sign-in expired or was already used; start again from the app.");
      return;
    }
    const client = await clients.find(pending.clientId);
    if ("error" in client) {
      problem(response, 400, client.description);
      return;
    }
    const viewer =
      pending.viewerSignin !== undefined
        ? read<ViewerSigninRecord>("authorize", pending.viewerSignin)
        : undefined;
    const homeId = viewer?.homeId;
    const needsConsent =
      client.kind === "shell"
        ? homeId !== undefined && !senderShown(signed.accountId, homeId)
        : !auth.consented(signed.accountId, client.id);
    if (needsConsent && request.method !== "POST") {
      consentPage(response, pending, client, handle, signed, homeId);
      return;
    }
    if (request.method === "POST") {
      // The page's own form only, from this browser's session (D166 item 10).
      const form = await readForm(request);
      if (
        request.headers.origin !== apiOrigin ||
        !form ||
        form.get("csrf") !== csrf(signed.hash, `consent ${handle}`)
      ) {
        problem(response, 403, "This form must be sent from its own page.");
        return;
      }
      if (form.get("decision") !== "approve") {
        spend(handle);
        toClient(response, pending.redirectUri, { error: "access_denied", state: pending.state });
        return;
      }
      if (client.kind === "shell" && homeId !== undefined)
        markSenderShown(signed.accountId, homeId);
      else auth.consent(signed.accountId, client.id);
    }
    if (!spend(handle)) {
      problem(response, 400, "This sign-in was already used.");
      return;
    }
    clients.used(client.id);
    const code = auth.issueCode({
      clientId: client.id,
      redirectUri: pending.redirectUri,
      challenge: pending.challenge,
      resource: pending.resource,
      scope: pending.scope,
      accountId: signed.accountId,
      redirectGiven: pending.redirectGiven !== false,
      ...(pending.viewerSignin !== undefined
        ? { viewerSignin: hashSecret(pending.viewerSignin) }
        : {}),
    });
    log.info("oauth.code_issued", { client: client.id });
    toClient(response, pending.redirectUri, { code, state: pending.state });
  };

  const senderShown = (accountId: string, homeId: string): boolean =>
    directory.read(
      (db) =>
        db.get(
          "SELECT 1 FROM sender_shown WHERE account_id = ? AND home_id = ?",
          accountId,
          homeId,
        ) !== undefined,
    );
  const markSenderShown = (accountId: string, homeId: string): void => {
    directory.write((db) =>
      db.run(
        "INSERT OR IGNORE INTO sender_shown (account_id, home_id, at) VALUES (?, ?, ?)",
        accountId,
        homeId,
        iso(now()),
      ),
    );
  };

  const consentPage = (
    response: ServerResponse,
    pending: AuthorizeRecord,
    client: OAuthClient,
    handle: string,
    signed: { accountId: string; hash: string },
    homeId: string | undefined,
  ): void => {
    const who = auth.accountName(signed.accountId).name ?? "your account";
    const redirectHost = new URL(pending.redirectUri).host;
    const loopback = /^(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?$/.test(redirectHost);
    const body =
      client.kind === "shell"
        ? `<p>Continue as <strong>${escapeHtml(who)}</strong> to answer <strong>${escapeHtml(
            (homeId !== undefined ? options.ownerName(homeId) : undefined) ?? "this person",
          )}</strong>'s page? They will see your name with your answers.</p>`
        : `<p><strong>${escapeHtml(client.name)}</strong>${client.unverified ? ' <span class="muted">(a name the app gives itself, not checked)</span>' : ""} asks to use Mostra as <strong>${escapeHtml(who)}</strong>: to read, create and change your hosted pages and their answers.</p>
<p>It will send you back to <strong>${escapeHtml(redirectHost)}</strong>.${loopback ? " That is a program on your own computer: continue only if you started this there." : ""}</p>`;
    send(
      response,
      200,
      shell(
        client.kind === "shell" ? "Answer as yourself" : "Allow access",
        `${body}<form method="post" action="/oauth/authorize/continue?authorize=${encodeURIComponent(handle)}">
<input type="hidden" name="csrf" value="${csrf(signed.hash, `consent ${handle}`)}">
<button name="decision" value="approve">${client.kind === "shell" ? "Continue" : "Allow"}</button>
<button name="decision" value="deny">Cancel</button></form>`,
      ),
      {},
      [new URL(pending.redirectUri).origin],
    );
  };

  const readForm = async (request: IncomingMessage): Promise<URLSearchParams | undefined> => {
    if (!(request.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) {
      return undefined;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > 16 * 1024) return undefined;
      chunks.push(chunk as Buffer);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  };

  /** `GET /oauth/authorize`. */
  const authorize = async (
    response: ServerResponse,
    query: URLSearchParams,
    request: IncomingMessage,
  ): Promise<void> => {
    // A parameter given twice is ambiguous: refused before anything else (RFC 6749 §3.1).
    for (const key of new Set(query.keys())) {
      if (query.getAll(key).length > 1) {
        problem(response, 400, `The request names ${key} twice.`);
        return;
      }
    }
    const clientId = query.get("client_id") ?? "";
    const client = await clients.find(clientId);
    if ("error" in client) {
      problem(response, 400, client.description);
      return;
    }
    const redirectUri =
      query.get("redirect_uri") ??
      (client.redirectUris.length === 1 ? (client.redirectUris[0] as string) : "");
    // Nothing goes to a redirect URI the client doesn't list (RFC 6749 §4.1.2.1).
    if (!redirectAllowed(client.redirectUris, redirectUri)) {
      problem(response, 400, "The redirect address isn't one this app registered.");
      return;
    }
    const state = query.get("state");
    const fail = (error: string, description: string) =>
      toClient(response, redirectUri, { error, error_description: description, state });
    if (query.get("response_type") !== "code")
      return fail("unsupported_response_type", "Only code.");
    const challenge = query.get("code_challenge") ?? "";
    if (query.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) {
      return fail("invalid_request", "PKCE with S256 is required.");
    }
    if (client.kind === "cli") return fail("unauthorized_client", "The CLI uses the device grant.");
    const scopes = (query.get("scope") ?? "mostra").split(" ").filter((part) => part !== "");
    if (!scopes.every((part) => part === "mostra" || part === "offline_access")) {
      return fail("invalid_scope", "The scopes are mostra and offline_access.");
    }
    const scope = ["mostra", ...(scopes.includes("offline_access") ? ["offline_access"] : [])].join(
      " ",
    );
    let resource = "";
    let viewerSignin: string | undefined;
    if (client.kind === "shell") {
      // A page's sign-in: started by its shell, bound to its route and session.
      viewerSignin = query.get("mostra_signin") ?? "";
      const started = read<ViewerSigninRecord>("authorize", viewerSignin);
      if (!started || started.clientId !== client.id || state !== viewerSignin) {
        return fail("invalid_request", "This page sign-in wasn't started from its page.");
      }
      resource = `${apiOrigin}/viewer`;
    } else {
      // The audience: the MCP endpoint (RFC 8707; every MCP client names it).
      resource = canonicalResource(query.get("resource") ?? `${apiOrigin}/mcp`);
      if (resource !== `${apiOrigin}/mcp`)
        return fail("invalid_target", `The resource is ${apiOrigin}/mcp.`);
    }
    const handle = token();
    keep("authorize", handle, {
      clientId: client.id,
      redirectUri,
      state,
      challenge,
      resource,
      scope,
      ...(viewerSignin !== undefined ? { viewerSignin } : {}),
      redirectGiven: query.get("redirect_uri") !== null,
    } satisfies AuthorizeRecord);
    const signed = sessionAccount(request);
    if (signed) {
      await proceed(request, response, handle, signed);
      return;
    }
    await signInPage(response, `/oauth/authorize/continue?authorize=${handle}`);
  };

  return {
    sessionAccount,
    csrf,
    signInPage,
    providers: async () =>
      (await providers()).map((provider) => ({ id: provider.id, label: provider.label })),

    startViewerSignin(signin, challenge) {
      const state = token();
      const clientId = clients.shellClientId(signin.shellOrigin);
      keep("authorize", state, { ...signin, clientId } satisfies ViewerSigninRecord);
      const url = new URL(`${apiOrigin}/oauth/authorize`);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", `${signin.shellOrigin}/_mostra/signin`);
      url.searchParams.set("state", state);
      url.searchParams.set("mostra_signin", state);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      return { url: url.href, state };
    },

    finishViewerSignin(input) {
      const started = read<ViewerSigninRecord>("authorize", input.state);
      // A code started on one route, or for another shell session, is refused here (login CSRF).
      if (!started || started.routeId !== input.routeId || started.sessionId !== input.sessionId) {
        return { refused: "This sign-in was started for another page." };
      }
      const redeemed = auth.redeemViewerCode({
        code: input.code,
        verifier: input.verifier,
        clientId: started.clientId,
        viewerSignin: hashSecret(input.state),
      });
      spend(input.state);
      if ("refused" in redeemed) return redeemed;
      const named = auth.accountName(redeemed.accountId);
      return {
        accountId: redeemed.accountId,
        ...(named.name !== undefined ? { name: named.name } : {}),
        ...(named.provider !== undefined ? { provider: named.provider } : {}),
      };
    },

    async handle(request, response, path) {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", apiOrigin);
      if (method === "GET" && path === "/oauth/authorize") {
        await authorize(response, url.searchParams, request);
        return true;
      }
      if (path === "/oauth/authorize/continue" && (method === "GET" || method === "POST")) {
        const handle = url.searchParams.get("authorize") ?? "";
        const signed = sessionAccount(request);
        if (!signed) {
          await signInPage(response, `/oauth/authorize/continue?authorize=${handle}`);
          return true;
        }
        await proceed(request, response, handle, signed);
        return true;
      }
      const start = /^\/signin\/([a-z][a-z0-9-]{0,31})\/start$/.exec(path);
      if (method === "GET" && start) {
        const provider = (await providers()).find((candidate) => candidate.id === start[1]);
        if (!provider) {
          problem(response, 404, "No such sign-in.");
          return true;
        }
        const state = token();
        const verifier = token();
        const challenge = createHash("sha256").update(verifier).digest("base64url");
        const nonce = token();
        const flow = token();
        keep("provider", state, {
          provider: provider.id,
          verifier,
          challenge,
          nonce,
          flow: hashSecret(flow),
          next: safeNext(url.searchParams.get("next")),
        } satisfies ProviderRecord);
        let target: string;
        try {
          target = await bounded(
            () =>
              provider.authorize(
                state,
                { challenge, method: "S256", verifier },
                { redirectUri: `${apiOrigin}/signin/${provider.id}/callback`, nonce },
              ),
            "the provider's sign-in address",
          );
          // Only to an https: page (a server on loopback http, as tests and a first run use, may
          // send its own providers' pages over http too).
          const parsed = new URL(target, apiOrigin);
          if (parsed.protocol !== "https:" && (secure || parsed.protocol !== "http:")) {
            throw new Error("the provider's sign-in address isn't https:");
          }
          target = parsed.href;
        } catch (error) {
          log.warn("signin.provider_failed", {
            provider: provider.id,
            message: (error as Error).message,
          });
          problem(
            response,
            503,
            `${provider.label} can't be reached right now; try again shortly.`,
          );
          return true;
        }
        redirect(response, target, {
          "set-cookie": setCookie(flowCookie, flow, Math.floor(PENDING_MS / 1000)),
        });
        return true;
      }
      const name = /^\/signin\/([a-z][a-z0-9-]{0,31})\/name$/.exec(path);
      const callback = /^\/signin\/([a-z][a-z0-9-]{0,31})\/callback$/.exec(path);
      if ((method === "GET" && callback) || (name && (method === "GET" || method === "POST"))) {
        const id = (callback ?? name)?.[1] as string;
        const provider = (await providers()).find((candidate) => candidate.id === id);
        if (!provider) {
          problem(response, 404, "No such sign-in.");
          return true;
        }
        if (name && method === "GET") {
          // The development provider's page: a name, trusted as typed (D166 item 4).
          const state = url.searchParams.get("state") ?? "";
          send(
            response,
            200,
            shell(
              "Development sign-in",
              `<p class="muted">This server signs people in with a development provider, which trusts the name you type. Use it only on a server you run for yourself or for tests.</p>
<form method="post" action="/signin/${escapeHtml(id)}/name"><input type="hidden" name="state" value="${escapeHtml(state)}">
<label>Your name <input name="name" required maxlength="64"></label> <button>Continue</button></form>`,
            ),
          );
          return true;
        }
        let params: Record<string, string>;
        if (name) {
          const form = await readForm(request);
          if (request.headers.origin !== apiOrigin || !form) {
            problem(response, 403, "This form must be sent from its own page.");
            return true;
          }
          params = Object.fromEntries(form.entries());
        } else {
          params = {};
          for (const key of new Set(url.searchParams.keys())) {
            if (url.searchParams.getAll(key).length > 1) {
              problem(response, 400, `The provider's answer names ${key} twice.`);
              return true;
            }
            params[key] = url.searchParams.get(key) as string;
          }
        }
        const state = params["state"] ?? "";
        const pending = read<ProviderRecord>("provider", state);
        const flow = cookies(request).get(flowCookie);
        // The sign-in this browser started, at this provider, once.
        if (
          !pending ||
          pending.provider !== provider.id ||
          flow === undefined ||
          hashSecret(flow) !== pending.flow ||
          !spend(state)
        ) {
          problem(
            response,
            400,
            "This sign-in expired, was used, or was started in another browser.",
          );
          return true;
        }
        let identity: SignInIdentity;
        try {
          const answered = await bounded(
            () =>
              provider.callback(params, {
                redirectUri: `${apiOrigin}/signin/${provider.id}/callback`,
                nonce: pending.nonce,
                state,
                pkce: { challenge: pending.challenge, method: "S256", verifier: pending.verifier },
              }),
            "the provider's answer",
          );
          // An operator's provider is checked as every operator answer is (D167): a malformed
          // identity names nobody.
          const checked = SignInIdentitySchema.safeParse({ ...answered, provider: provider.id });
          if (!checked.success) throw new Error("the provider named nobody this server can use");
          identity = checked.data;
        } catch (error) {
          log.warn("signin.callback_failed", {
            provider: provider.id,
            message: (error as Error).message,
          });
          problem(
            response,
            400,
            `${provider.label} didn't sign you in: ${(error as Error).message}`,
          );
          return true;
        }
        await resolved(response, identity, verifierOf(provider), 0, pending.flow, pending.next);
        return true;
      }
      if (method === "GET" && path === "/signin/return") {
        const handle = url.searchParams.get("step") ?? "";
        const step = read<StepRecord>("step", handle);
        const flow = cookies(request).get(flowCookie);
        if (!step || flow === undefined || hashSecret(flow) !== step.flow || !spend(handle)) {
          problem(
            response,
            400,
            "This sign-in step expired, was used, or belongs to another browser.",
          );
          return true;
        }
        await resolved(response, step.identity, step.verifiedBy, step.steps, step.flow, step.next);
        return true;
      }
      return false;
    },
  };
}
