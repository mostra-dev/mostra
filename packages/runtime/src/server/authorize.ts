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
 * - `prompt` (OpenID Connect Core §3.1.2.1, MT-06): `login` signs the person in through their
 *   provider again whatever the browser's session, and `consent` asks again for consent given
 *   before; any other value is refused (`invalid_request`).
 * - Signing out (`/signout`, MT-06): `POST` ends the browser's session (its row and its cookie),
 *   from this origin's own pages (their `Origin` and a CSRF token derived from the session) or from
 *   an operator's own app (`operatorClients`, its pages' exact `Origin`); `GET` is a page with one
 *   button and ends nothing. A client's sign-out returns only to an address it registered
 *   (`post_logout_redirect_uris`, OpenID Connect RP-Initiated Logout 1.0). Every page that shows
 *   who is signed in carries "Signed in as Ada · Sign out".
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
import { readAppearance } from "@mostra/themes";
import { type ServerPages, themePageCsp } from "../gateway/index.ts";
import type { Ledger } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import { type Authorization, canonicalResource, hashSecret } from "./auth.ts";
import { verifierLabel } from "./config.ts";
import { type Clients, type OAuthClient, redirectAllowed } from "./oauth-clients.ts";
import type { Operator } from "./operator.ts";
import {
  API_PAGE_WORDS,
  type ApiPages,
  type PageRequest,
  SIGNOUT_PATH,
  type SignedIn,
} from "./pages.ts";

/** How long an authorization request, a provider sign-in or a step waits. */
const PENDING_MS = 15 * 60_000;
/** How long a browser stays signed in to the API origin. */
const SESSION_MS = 7 * 24 * 60 * 60_000;
/** The `prompt` values an authorization request may carry (MT-06), advertised in the metadata. */
export const PROMPT_VALUES: readonly string[] = ["login", "consent"];
/** The longest `state` a sign-out may carry back to its client. */
const MAX_STATE = 512;
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
  /** The server's own pages (its operator's theme and name, D171) and the API origin's on them. */
  readonly server: ServerPages;
  readonly pages: ApiPages;
  readonly now?: () => number;
  /** How long a browser's sign-in lasts (7 days); tests shorten it (`MOSTRA_TEST_SIGNIN_SESSION_MS`). */
  readonly sessionMs?: number;
}

/**
 * Where a page answers and what its reader chose (their appearance, D171), from the request a
 * response answers.
 */
export function pageRequest(response: ServerResponse): PageRequest {
  const request = response.req as IncomingMessage | undefined;
  const cookie = request?.headers.cookie;
  // Without a choice of their own, a person gets the operator's default (the pages know it).
  const chosen = cookie?.includes("mostra-appearance=") ? readAppearance(cookie) : undefined;
  return { ...(chosen ? { appearance: chosen } : {}), path: request?.url ?? "/" };
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
    prompt?: "consent",
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
  sessionAccount(request: IncomingMessage): BrowserSession | undefined;
  /** A CSRF token for a signed-in browser's form. */
  csrf(sessionHash: string, purpose: string): string;
  /**
   * What a page says of a signed-in browser, with its "Sign out" (MT-06): the account's name, the
   * sign-out's CSRF token, and where the person continues once signed out (`next`, this origin).
   */
  signedIn(session: BrowserSession, next: string): SignedIn;
  /** The providers a sign-in may use now: configured ones, then the operator's. */
  providers(): Promise<readonly { readonly id: string; readonly label: string }[]>;
  /** Starts a sign-in whose end continues at a page of the API origin (the device page). */
  signInPage(
    response: ServerResponse,
    next: string,
    message?: string,
    signedIn?: SignedIn,
  ): Promise<void>;
}

/** A browser's sign-in on the API origin: its account, its row's hash and when it began. */
export interface BrowserSession {
  readonly accountId: string;
  readonly hash: string;
  readonly createdAt: number;
}

const BASE = {
  "cache-control": "no-store",
  "cross-origin-resource-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

/** Builds the pages. */
export function createAuthorize(options: AuthorizeOptions): Authorize {
  const { apiOrigin, directory, auth, clients, operator, log, pages } = options;
  const at = (response: ServerResponse): PageRequest => pageRequest(response);
  const now = options.now ?? (() => Date.now());
  const sessionMs = options.sessionMs ?? SESSION_MS;
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
      // The page loads its theme's files from this origin and runs nothing. A form posts here,
      // and its answer may redirect to a client: those origins only.
      "content-security-policy": themePageCsp(
        options.server.pages,
        "'none'",
        ["'self'", ...formTargets].join(" "),
      ),
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
    send(response, status, pages.problem(at(response), message));

  // ── in-progress records ─────────────────────────────────────────────────────────────────

  const keep = (kind: "provider" | "step" | "authorize", handle: string, data: unknown): void =>
    // An expired record is swept by the server's periodic sweep (`sweep.ts`, MT-06), never here:
    // every read checks its expiry itself.
    directory.write((db) => {
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

  /** The hash of the session cookie a request carries, when it carries one in its shape. */
  const sessionHashOf = (request: IncomingMessage): string | undefined => {
    const value = cookies(request).get(sessionCookie);
    return value !== undefined && /^[A-Za-z0-9_-]{43}$/.test(value) ? hashSecret(value) : undefined;
  };
  const sessionAccount = (request: IncomingMessage): BrowserSession | undefined => {
    const hash = sessionHashOf(request);
    if (hash === undefined) return undefined;
    const row = directory.read((db) =>
      db.get<{ account_id: string; created_at: string; expires_at: string; status: string }>(
        `SELECT s.account_id, s.created_at, s.expires_at, a.status FROM browser_session s
           JOIN account a ON a.id = s.account_id WHERE s.hash = ?`,
        hash,
      ),
    );
    if (!row || Date.parse(row.expires_at) <= now() || row.status !== "active") return undefined;
    return { accountId: row.account_id, hash, createdAt: Date.parse(row.created_at) };
  };
  /**
   * A new sign-in's session; it replaces the one the browser had (its row goes in the same
   * transaction), so a browser holds one sign-in at a time and a fresh one (`prompt=login`) leaves
   * nothing of the last (MT-06).
   */
  const startSession = (accountId: string, replacing: string | undefined): string => {
    const value = token();
    directory.write((db) => {
      if (replacing !== undefined) db.run("DELETE FROM browser_session WHERE hash = ?", replacing);
      db.run(
        "INSERT INTO browser_session (hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
        hashSecret(value),
        accountId,
        iso(now()),
        iso(now() + sessionMs),
      );
    });
    return setCookie(sessionCookie, value, Math.floor(sessionMs / 1000));
  };
  /** The cookies that end a browser's sign-in here: its session's and a sign-in in progress's. */
  const clearCookies = (): string[] => [
    setCookie(sessionCookie, "", 0),
    setCookie(flowCookie, "", 0),
  ];
  const signedIn = (session: BrowserSession, next: string): SignedIn => ({
    name: auth.accountName(session.accountId).name ?? API_PAGE_WORDS.yourAccount,
    csrf: csrf(session.hash, "signout"),
    next,
  });
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
    signed?: SignedIn,
  ): Promise<void> => {
    const list = await providers();
    send(
      response,
      200,
      pages.signIn(
        at(response),
        list.map((provider) => ({ id: provider.id, label: provider.label })),
        next,
        message,
        signed,
      ),
    );
  };

  /** Where a finished sign-in continues: an address of the API origin only. */
  const safeNext = (next: string | null): string =>
    next?.startsWith("/") && !next.startsWith("//") ? next : "/";

  /** A resolved identity: a session and on to `next`, a step, or why not. */
  const resolved = async (
    request: IncomingMessage,
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
      "set-cookie": [
        startSession(account.accountId, sessionHashOf(request)),
        setCookie(flowCookie, "", 0),
      ],
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
    /**
     * `prompt=login`: when the request was made; only a sign-in at or after it continues it (a
     * session the browser had before never does, MT-06).
     */
    readonly login?: number;
    /** `prompt=consent`: consent is asked again though it was given before (MT-06). */
    readonly consent?: true;
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
    signed: BrowserSession,
  ): Promise<void> => {
    const pending = read<AuthorizeRecord>("authorize", handle);
    if (!pending) {
      problem(response, 400, "This sign-in expired or was already used; start again from the app.");
      return;
    }
    const resume = `/oauth/authorize/continue?authorize=${handle}`;
    // `prompt=login`: only a sign-in made for this request continues it (MT-06).
    if (pending.login !== undefined && signed.createdAt < pending.login) {
      await signInPage(response, resume, undefined, signedIn(signed, resume));
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
      pending.consent === true ||
      (client.kind === "shell"
        ? homeId !== undefined && !senderShown(signed.accountId, homeId)
        : !auth.consented(signed.accountId, client.id));
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
    signed: BrowserSession,
    homeId: string | undefined,
  ): void => {
    const who = signedIn(signed, `/oauth/authorize/continue?authorize=${handle}`);
    const redirectHost = new URL(pending.redirectUri).host;
    const loopback = /^(127\.0\.0\.1|\[::1\]|localhost)(:\d+)?$/.test(redirectHost);
    const form = {
      action: `/oauth/authorize/continue?authorize=${encodeURIComponent(handle)}`,
      csrf: csrf(signed.hash, `consent ${handle}`),
    };
    send(
      response,
      200,
      client.kind === "shell"
        ? pages.answerAs(
            at(response),
            form,
            who,
            homeId !== undefined ? options.ownerName(homeId) : undefined,
          )
        : pages.allow(at(response), form, client, who, redirectHost, loopback),
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
    // `prompt` (OpenID Connect Core §3.1.2.1): `login` and `consent`, together or alone; a value
    // this server doesn't implement is refused, never ignored (MT-06).
    const prompt = query.get("prompt");
    const prompts = prompt === null ? [] : prompt.split(" ");
    if (
      prompt !== null &&
      (prompts.length === 0 || !prompts.every((value) => PROMPT_VALUES.includes(value)))
    ) {
      return fail("invalid_request", `prompt takes ${PROMPT_VALUES.join(" and ")} only.`);
    }
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
      ...(prompts.includes("login") ? { login: now() } : {}),
      ...(prompts.includes("consent") ? { consent: true as const } : {}),
    } satisfies AuthorizeRecord);
    const signed = sessionAccount(request);
    const resume = `/oauth/authorize/continue?authorize=${handle}`;
    // With `prompt=login`, a session the browser has is shown with its "Sign out", never used.
    if (signed && !prompts.includes("login")) {
      await proceed(request, response, handle, signed);
      return;
    }
    await signInPage(response, resume, undefined, signed ? signedIn(signed, resume) : undefined);
  };

  // ── signing out (MT-06) ─────────────────────────────────────────────────────────────────

  /**
   * What a sign-out names: its client, and where it sends the person back (an address the client
   * registered, matched exactly, with the request's `state`), or why it can't.
   */
  const signOutTarget = async (
    params: URLSearchParams,
  ): Promise<
    { readonly client?: OAuthClient; readonly back?: string } | { readonly refused: string }
  > => {
    const clientId = params.get("client_id");
    const back = params.get("post_logout_redirect_uri");
    const state = params.get("state");
    if (clientId === null || clientId === "") {
      return back === null ? {} : { refused: "This sign-out doesn't name its app (client_id)." };
    }
    const client = await clients.find(clientId);
    if ("error" in client) return { refused: client.description };
    if (back === null) return { client };
    if (!client.postLogoutRedirectUris.includes(back)) {
      return {
        refused: "The address to go back to isn't one this app registered for signing out.",
      };
    }
    if (state !== null && state.length > MAX_STATE) {
      return { refused: "This sign-out's state is too long." };
    }
    const url = new URL(back);
    if (state !== null) url.searchParams.set("state", state);
    return { client, back: url.href };
  };

  /** A request whose parameters name one twice is ambiguous, and refused (RFC 6749 §3.1). */
  const twice = (params: URLSearchParams): string | undefined =>
    [...new Set(params.keys())].find((key) => params.getAll(key).length > 1);

  /** A path of this origin to continue at, else none. */
  const ownPath = (next: string | null): string | undefined =>
    next?.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : undefined;

  /** `GET /signout`: a page with one button, or nothing to do; it ends nothing (D98). */
  const signOutPage = async (
    request: IncomingMessage,
    response: ServerResponse,
    params: URLSearchParams,
  ): Promise<void> => {
    const repeated = twice(params);
    if (repeated !== undefined) {
      problem(response, 400, `The request names ${repeated} twice.`);
      return;
    }
    const target = await signOutTarget(params);
    if ("refused" in target) {
      problem(response, 400, target.refused);
      return;
    }
    const next = ownPath(params.get("next"));
    const signed = sessionAccount(request);
    if (!signed) {
      // Nothing to end: back to the app that asked, or the page that says so.
      if (target.back !== undefined) redirect(response, target.back);
      else send(response, 200, pages.signedOut(at(response), next));
      return;
    }
    const fields: Record<string, string> = {};
    for (const key of ["client_id", "post_logout_redirect_uri", "state"]) {
      const value = params.get(key);
      if (value !== null && target.client !== undefined) fields[key] = value;
    }
    if (next !== undefined) fields["next"] = next;
    send(
      response,
      200,
      pages.signOut(at(response), {
        name: signedIn(signed, "/").name,
        csrf: csrf(signed.hash, "signout"),
        fields,
        ...(target.client !== undefined && target.back !== undefined
          ? {
              client: {
                name: target.client.name,
                trust: target.client.trust,
                back: new URL(target.back).host,
              },
            }
          : {}),
      }),
      {},
      target.back !== undefined ? [new URL(target.back).origin] : [],
    );
  };

  /**
   * `POST /signout`: ends this browser's sign-in here, its row and its cookies. From this origin's
   * own pages with the session's CSRF token, or from an operator's own app (`operatorClients`) by
   * its pages' exact `Origin`, whose form a browser of another site sends without the cookie: the
   * cookie is then cleared and its row left to expire. From anywhere else it is refused, and ends
   * nothing (a forced sign-out is a cross-site request forgery too).
   */
  const signOut = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const form = await readForm(request);
    const origin = request.headers.origin;
    if (!form) {
      problem(response, 400, "This form must be sent from its own page.");
      return;
    }
    const repeated = twice(form);
    if (repeated !== undefined) {
      problem(response, 400, `The request names ${repeated} twice.`);
      return;
    }
    const own = origin === apiOrigin;
    if (!own) {
      const clientId = form.get("client_id") ?? "";
      const client = clientId === "" ? undefined : await clients.find(clientId);
      const operator =
        client !== undefined &&
        !("error" in client) &&
        client.trust === "operator" &&
        origin !== undefined &&
        clients.pagesOrigin(client) === origin;
      if (!operator) {
        log.warn("signin.signout_refused", { origin: (origin ?? "(none)").slice(0, 200) });
        problem(
          response,
          403,
          "Signing out here works from this server's own pages and apps only.",
        );
        return;
      }
    }
    const signed = sessionAccount(request);
    if (own && signed && form.get("csrf") !== csrf(signed.hash, "signout")) {
      problem(response, 403, "This form must be sent from its own page.");
      return;
    }
    const target = await signOutTarget(form);
    const hash = sessionHashOf(request);
    if (hash !== undefined) {
      directory.write((db) => db.run("DELETE FROM browser_session WHERE hash = ?", hash));
    }
    log.info("signin.signed_out", { by: own ? "page" : "client", session: hash !== undefined });
    const cleared = { "set-cookie": clearCookies() };
    if (!("refused" in target) && target.back !== undefined) {
      redirect(response, target.back, cleared);
      return;
    }
    const next = ownPath(form.get("next"));
    redirect(
      response,
      `${apiOrigin}${SIGNOUT_PATH}${next !== undefined ? `?next=${encodeURIComponent(next)}` : ""}`,
      cleared,
    );
  };

  return {
    sessionAccount,
    csrf,
    signedIn,
    signInPage,
    providers: async () =>
      (await providers()).map((provider) => ({ id: provider.id, label: provider.label })),

    startViewerSignin(signin, challenge, prompt) {
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
      // A page signed out here asks "Answer as yourself" again, whoever is signed in (MT-06).
      if (prompt === "consent") url.searchParams.set("prompt", "consent");
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
      if (path === SIGNOUT_PATH && method === "GET") {
        await signOutPage(request, response, url.searchParams);
        return true;
      }
      if (path === SIGNOUT_PATH && method === "POST") {
        await signOut(request, response);
        return true;
      }
      if (method === "GET" && path === "/oauth/authorize") {
        await authorize(response, url.searchParams, request);
        return true;
      }
      if (path === "/oauth/authorize/continue" && (method === "GET" || method === "POST")) {
        const handle = url.searchParams.get("authorize") ?? "";
        const signed = sessionAccount(request);
        if (!signed) {
          await signInPage(
            response,
            `/oauth/authorize/continue?authorize=${encodeURIComponent(handle)}`,
          );
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
          send(response, 200, pages.developmentName(at(response), id, state));
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
        await resolved(
          request,
          response,
          identity,
          verifierOf(provider),
          0,
          pending.flow,
          pending.next,
        );
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
        await resolved(
          request,
          response,
          step.identity,
          step.verifiedBy,
          step.steps,
          step.flow,
          step.next,
        );
        return true;
      }
      return false;
    },
  };
}
