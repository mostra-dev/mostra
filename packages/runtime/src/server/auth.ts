/**
 * The remote server's authorization server, as far as WP-29 builds it (INTERFACES §18.5, D165
 * items 2, 8): the OAuth 2.0 device authorization grant (RFC 8628) behind `mostra login`, with
 * rotating refresh tokens and revocation, and a development identity provider for tests and a
 * self-hoster's first run. WP-30 adds the real identity providers, viewer sign-in and the MCP
 * clients' flows on the same tables.
 *
 * Every token is an opaque random secret, stored only as its SHA-256 (DATA_MODEL §7.1): a copy of
 * the directory grants nothing. Access tokens last an hour; a refresh token rotates on every use,
 * returns the same successor for 30 s after it was used, so parallel refreshes don't collide, and a
 * use after that revokes its grant. The device page says that approving links a machine to the
 * account, and a new link is the hosted event `instance.linked`.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { AccountId, HomeId, LinkId } from "@mostra/protocol";
import type { SignInIdentity } from "@mostra/protocol/operator";
import type { Ledger, LedgerDb } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import type { RemoteServerConfig } from "./config.ts";
import type { Operator } from "./operator.ts";

/** The CLI's client ID: a first-party public client (§18.5). */
export const CLI_CLIENT_ID = "mostra-cli";

/** The device grant's type (RFC 8628 §3.4). */
export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const DEVICE_TTL_MS = 10 * 60 * 1000;
const DEVICE_INTERVAL_S = 5;
const ROTATION_GRACE_MS = 30_000;
/** An authorization code lives a minute (OAuth 2.1 §4.1.2: short-lived). */
const CODE_TTL_MS = 60_000;
/** How long a used or expired code is kept to recognize its reuse (an hour). */
const CODE_KEPT_MS = 60 * 60 * 1000;

/** User codes: eight letters a person can't confuse (RFC 8628 §6.1), shown as `ABCD-EFGH`. */
const USER_CODE_LETTERS = "BCDFGHJKLMNPQRSTVWXZ";

/** What a valid access token names. */
export interface Authenticated {
  /** The resource (audience) the token was issued for: `<apiOrigin>/host` or `<apiOrigin>/mcp`. */
  readonly resource: string;
  /** The client the grant is for. */
  readonly clientId: string;
  /** The grant's scopes, space-separated. */
  readonly scope: string;
  readonly accountId: string;
  readonly accountName: string | undefined;
  readonly grantId: string;
  readonly homeId: string;
  readonly linkId: string | undefined;
  readonly expiresAt: number;
}

/** An OAuth error answer (RFC 6749 §5.2, RFC 8628 §3.5). */
export interface OAuthError {
  readonly status: number;
  readonly error: string;
  readonly description: string;
}

/** The token endpoint's success answer. */
export interface TokenAnswer {
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly scope: string;
  readonly mostra_account: { readonly id: string; readonly name?: string };
  readonly mostra_instance?: string;
  /** Whether this instance is the account's default instance (D165 item 1b). */
  readonly mostra_default?: boolean;
  /** The account's hosted home. */
  readonly mostra_home?: string;
}

/** What an authorization code carries, kept with its hash (one minute, single use). */
export interface CodeGrant {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly resource: string;
  readonly scope: string;
  readonly accountId: string;
  /** A hosted shell's viewer sign-in this code finishes (INTERFACES §18.4). */
  readonly viewerSignin?: string;
  /**
   * Whether the authorization request named its redirect URI; the token request must name it
   * too then (OAuth 2.1 §4.1.3). Absent: it did.
   */
  readonly redirectGiven?: boolean;
}

/** A sign-in identity resolved to the server's account, or why not. */
export type ResolvedAccount =
  | { readonly kind: "account"; readonly accountId: string; readonly name: string | undefined }
  | { readonly kind: "step"; readonly url: string }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "suspended" }
  | { readonly kind: "unavailable" };

/** The SHA-256 of a secret, as the directory stores it. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function secret(): string {
  return randomBytes(32).toString("base64url");
}

function userCode(): string {
  let code = "";
  for (let index = 0; index < 8; index++)
    code += USER_CODE_LETTERS[randomInt(USER_CODE_LETTERS.length)];
  return code;
}

/** Whether a PKCE verifier hashes to the S256 challenge (RFC 7636 §4.6), in constant time. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = createHash("sha256").update(verifier).digest("base64url");
  return (
    computed.length === challenge.length &&
    timingSafeEqual(Buffer.from(computed), Buffer.from(challenge))
  );
}

/**
 * A resource indicator in its canonical form (RFC 8707; the MCP specification): scheme and host in
 * lower case, no trailing slash, no fragment. An unusable one answers `""`.
 */
export function canonicalResource(resource: string): string {
  try {
    // WHATWG URL parsing already lower-cases the scheme and host.
    const url = new URL(resource);
    if (url.hash !== "" || url.search !== "") return "";
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

/** `abcd-efgh`, `ABCDEFGH` → `ABCDEFGH`. */
function normalizeUserCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z]/g, "");
}

/** The device grant's state, kept in its `token` row's `data_json`. */
interface DeviceState {
  readonly userCode: string;
  readonly status: "pending" | "approved" | "denied";
  readonly accountId?: string;
  readonly instance?: string;
  readonly name?: string;
  readonly lastPollAt?: number;
  /** The instance asked to become the account's default (`mostra login --default`). */
  readonly makeDefault?: boolean;
}

/** Options for {@link createAuthorization}. */
export interface AuthorizationOptions {
  readonly directory: Ledger;
  readonly config: RemoteServerConfig;
  readonly log: Log;
  /** The operator module, for `accounts.resolve` and `accounts.status` (D165 item 9). */
  readonly operator?: Operator;
  readonly now?: () => number;
  /** How long an access token lasts; an hour unless tests shorten it. */
  readonly accessTtlMs?: number;
  /** How long a used refresh token returns its successor; 30 s unless tests shorten it. */
  readonly rotationGraceMs?: number;
  /**
   * Called when an instance link was made or bound again (`instance.linked`, §18.5): the server
   * appends the event in the hosted home.
   */
  readonly linked?: (event: {
    readonly homeId: string;
    readonly linkId: string;
    readonly name: string;
  }) => void;
}

/** The authorization server. */
export interface Authorization {
  /** `POST /oauth/device`. */
  device(form: URLSearchParams): Record<string, unknown> | OAuthError;
  /** `POST /oauth/token`. */
  token(form: URLSearchParams): TokenAnswer | OAuthError;
  /** `POST /oauth/revoke` (RFC 7009): revokes the grant a token belongs to. */
  revoke(form: URLSearchParams): void;
  /** What a bearer token names, or `undefined` when it is unknown, expired or revoked. */
  authenticate(bearer: string): Authenticated | undefined;
  /** Whether a grant is still live (not revoked, its account active). */
  grantLive(grantId: string): boolean;
  /** The device page's state for a user code: pending, or why it can't be approved. */
  pendingCode(
    code: string,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: string };
  /**
   * Approves or denies a device code as `person` (the development provider's name, or WP-30's
   * signed-in identity), recording the account's consent for the CLI.
   */
  decide(input: {
    readonly code: string;
    readonly approve: boolean;
    readonly identity: {
      readonly provider: string;
      readonly subject: string;
      readonly name?: string;
    };
  }): { readonly ok: true } | { readonly ok: false; readonly reason: string };
  /** The verification address people open. */
  readonly verificationUri: string;
  /** Approves or denies a device code for an account a browser session signed in as. */
  decideFor(input: {
    readonly code: string;
    readonly approve: boolean;
    readonly accountId: string;
  }): { readonly ok: true } | { readonly ok: false; readonly reason: string };
  /**
   * Resolves a sign-in identity to an account (INTERFACES §18.5): through the operator's
   * `accounts.resolve` when it has one, else the server's own accounts; `steps` counts the first
   * sign-in steps already taken.
   */
  resolveAccount(identity: SignInIdentity, steps: number): Promise<ResolvedAccount>;
  /** An account's display name, and the provider that verified it (its first identity's). */
  accountName(accountId: string): { readonly name?: string; readonly provider?: string };
  /** Mints an authorization code (one minute, single use; only its hash is kept). */
  issueCode(grant: CodeGrant): string;
  /**
   * Redeems a hosted shell's viewer sign-in code (never at the token endpoint): its client, PKCE
   * verifier and sign-in must match. Answers the account, or why not.
   */
  redeemViewerCode(input: {
    readonly code: string;
    readonly verifier: string;
    readonly clientId: string;
    readonly viewerSignin: string;
  }): { readonly accountId: string } | { readonly refused: string };
  /**
   * A session for a credential the operator issued (`accounts.authenticate`, §18.6): the account
   * (kept under the operator's ID), its hosted home, and one instance link per credential subject,
   * so a program holding an operator-issued key runs an always-on owner instance.
   */
  credentialSession(input: {
    readonly account: string;
    readonly subject: string;
    readonly resource: string;
    /** Whether this use links an instance (the binding's, `/host`); `/mcp` and `/files` don't. */
    readonly link: boolean;
  }): Authenticated;
  /** The account a refresh token belongs to, so the operator's word on it is asked first. */
  refreshAccount(refreshToken: string): string | undefined;
  /** An account's standing in the directory. */
  accountStatus(accountId: string): "active" | "suspended";
  /** Records the operator's word on an account (`accounts.status`, §18.6). */
  setAccountStatus(accountId: string, status: "active" | "suspended"): void;
  /**
   * Whether an instance link is its account's default, after making it so when `makeDefault`
   * (`POST /link`, D167; one default per account, as `mostra login --default` makes it).
   */
  linkState(linkId: string, makeDefault: boolean): { readonly default: boolean };
  /** The account's hosted home, made on its first use (one home per owner per server). */
  ensureHome(accountId: string): string;
  /** Whether an account has consented to a client. */
  consented(accountId: string, clientId: string): boolean;
  /** Records an account's consent to a client. */
  consent(accountId: string, clientId: string): void;
}

function oauthError(status: number, error: string, description: string): OAuthError {
  return { status, error, description };
}

/** Creates the authorization server over the server's directory. */
export function createAuthorization(options: AuthorizationOptions): Authorization {
  const { directory, config, log } = options;
  const now = options.now ?? (() => Date.now());
  const accessTtlMs = options.accessTtlMs ?? ACCESS_TTL_MS;
  const rotationGraceMs = options.rotationGraceMs ?? ROTATION_GRACE_MS;
  const iso = (ms: number): string => new Date(ms).toISOString();
  const verificationUri = `${config.apiOrigin}/device`;

  directory.write((db) => {
    db.run(
      "INSERT OR IGNORE INTO oauth_client (id, kind, metadata_json, created_at) VALUES (?, 'cli', ?, ?)",
      CLI_CLIENT_ID,
      JSON.stringify({ client_name: "Mostra CLI" }),
      iso(now()),
    );
  });

  const deviceRow = (db: LedgerDb, hash: string) =>
    db.get<{ data_json: string; expires_at: string }>(
      "SELECT data_json, expires_at FROM token WHERE hash = ? AND kind = 'device'",
      hash,
    );

  /** An account the operator names: kept in the directory under the operator's own ID. */
  const operatorAccount = (
    db: LedgerDb,
    identity: { provider: string; subject: string; name?: string; email?: string },
    account: string,
    name: string | undefined,
    status: "active" | "suspended",
  ): void => {
    db.run(
      `INSERT INTO account (id, name, status, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = COALESCE(excluded.name, name), status = excluded.status`,
      account,
      name ?? identity.name ?? null,
      status,
      iso(now()),
    );
    db.run(
      `INSERT INTO identity (provider, subject, account_id, email, name, linked_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (provider, subject) DO UPDATE SET account_id = excluded.account_id,
           email = excluded.email, name = excluded.name`,
      identity.provider,
      identity.subject,
      account,
      identity.email ?? null,
      identity.name ?? null,
      iso(now()),
    );
  };

  /** The account for a sign-in identity, made on the first sign-in. */
  const accountFor = (
    db: LedgerDb,
    identity: { provider: string; subject: string; name?: string },
  ): string => {
    const found = db.get<{ account_id: string }>(
      "SELECT account_id FROM identity WHERE provider = ? AND subject = ?",
      identity.provider,
      identity.subject,
    );
    if (found) return found.account_id;
    const account = AccountId.create();
    db.run(
      "INSERT INTO account (id, name, status, created_at) VALUES (?, ?, 'active', ?)",
      account,
      identity.name ?? null,
      iso(now()),
    );
    db.run(
      "INSERT INTO identity (provider, subject, account_id, name, linked_at) VALUES (?, ?, ?, ?, ?)",
      identity.provider,
      identity.subject,
      account,
      identity.name ?? null,
      iso(now()),
    );
    return account;
  };

  /** The account's hosted home, made on its first link (one home per owner per server). */
  const homeFor = (db: LedgerDb, account: string): string => {
    const found = db.get<{ id: string }>("SELECT id FROM home WHERE owner_account_id = ?", account);
    if (found) return found.id;
    const home = HomeId.create();
    db.run(
      "INSERT INTO home (id, owner_account_id, data_path, created_at) VALUES (?, ?, ?, ?)",
      home,
      account,
      `homes/${home}`,
      iso(now()),
    );
    return home;
  };

  /** Makes or binds again the instance link a sign-in names. */
  const linkFor = (
    db: LedgerDb,
    account: string,
    home: string,
    wanted: string | undefined,
    name: string,
  ): string => {
    if (wanted !== undefined && LinkId.is(wanted)) {
      const row = db.get<{ account_id: string }>(
        "SELECT account_id FROM instance_link WHERE id = ?",
        wanted,
      );
      // A link is rebound only for its own account: another account's ID names nothing here.
      if (row?.account_id === account) {
        db.run("UPDATE instance_link SET revoked_at = NULL, name = ? WHERE id = ?", name, wanted);
        return wanted;
      }
    }
    const link = LinkId.create();
    const first =
      db.get<{ n: number }>("SELECT COUNT(*) AS n FROM instance_link WHERE account_id = ?", account)
        ?.n === 0;
    db.run(
      "INSERT INTO instance_link (id, account_id, home_id, name, is_default, relay_high, linked_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
      link,
      account,
      home,
      name,
      first ? 1 : 0,
      iso(now()),
    );
    return link;
  };

  /** Issues an access and a refresh token for a grant. */
  const issue = (db: LedgerDb, grantId: string): { access: string; refresh: string } => {
    const access = secret();
    const refresh = secret();
    db.run(
      "INSERT INTO token (hash, grant_id, kind, expires_at) VALUES (?, ?, 'access', ?)",
      hashSecret(access),
      grantId,
      iso(now() + accessTtlMs),
    );
    db.run(
      "INSERT INTO token (hash, grant_id, kind, expires_at) VALUES (?, ?, 'refresh', ?)",
      hashSecret(refresh),
      grantId,
      iso(now() + REFRESH_TTL_MS),
    );
    return { access, refresh };
  };

  const answer = (
    db: LedgerDb,
    grantId: string,
    tokens: { access: string; refresh: string },
  ): TokenAnswer => {
    const row = db.get<{
      account_id: string;
      link_id: string | null;
      name: string | null;
      is_default: number | null;
      home_id: string | null;
      scope: string;
    }>(
      `SELECT g.account_id, g.link_id, a.name, l.is_default, l.home_id, g.scope
         FROM "grant" g JOIN account a ON a.id = g.account_id
         LEFT JOIN instance_link l ON l.id = g.link_id WHERE g.id = ?`,
      grantId,
    );
    if (!row) throw new Error("grant vanished");
    return {
      access_token: tokens.access,
      token_type: "Bearer",
      expires_in: Math.max(1, Math.floor(accessTtlMs / 1000)),
      refresh_token: tokens.refresh,
      scope: row.scope,
      mostra_account: { id: row.account_id, ...(row.name !== null ? { name: row.name } : {}) },
      // An instance's link, for the CLI's device grant; an MCP client's grant has none.
      ...(row.link_id !== null
        ? {
            mostra_instance: row.link_id,
            mostra_default: row.is_default === 1,
            mostra_home: row.home_id ?? "",
          }
        : {}),
    };
  };

  /**
   * The successors of refresh tokens used in the last 30 s, by the used token's hash: kept in
   * memory only, so the directory never holds a usable secret. After a restart inside the grace, a
   * repeated refresh is refused without revoking anything; the client still holds its successor.
   */
  const recent = new Map<
    string,
    { readonly tokens: { access: string; refresh: string }; readonly at: number }
  >();
  const forgetOld = (): void => {
    for (const [hash, entry] of recent) if (now() - entry.at > rotationGraceMs) recent.delete(hash);
  };

  /** `grant_type=refresh_token`: rotation with a 30 s grace, reuse after it revokes the grant. */
  const refresh = (form: URLSearchParams, clientId: string): TokenAnswer | OAuthError => {
    const presented = form.get("refresh_token") ?? "";
    const hash = hashSecret(presented);
    return directory.write((db): TokenAnswer | OAuthError => {
      const row = db.get<{
        grant_id: string;
        expires_at: string;
        used_at: string | null;
      }>(
        "SELECT grant_id, expires_at, used_at FROM token WHERE hash = ? AND kind = 'refresh'",
        hash,
      );
      if (
        !row ||
        !grantLiveIn(db, row.grant_id, { anyStatus: true }) ||
        grantClient(db, row.grant_id) !== clientId
      ) {
        return oauthError(400, "invalid_grant", "The refresh token isn't valid; sign in again.");
      }
      // A suspended account's refresh token stays good: the refresh is refused for now, without
      // touching the token, so the instance or client keeps it and refreshes once the operator
      // lifts the suspension. `invalid_grant` would tell it to sign in again (second Fable
      // review of WP-30, 1).
      if (!grantLiveIn(db, row.grant_id)) {
        return oauthError(
          403,
          "temporarily_unavailable",
          "This account is suspended; its sign-in works again once the server's operator lifts the suspension.",
        );
      }
      if (Date.parse(row.expires_at) <= now()) {
        return oauthError(400, "invalid_grant", "The refresh token expired; sign in again.");
      }
      if (row.used_at !== null) {
        const used = Date.parse(row.used_at);
        forgetOld();
        if (now() - used <= rotationGraceMs) {
          // A parallel refresh within the grace: the same successor (§18.5).
          const kept = recent.get(hash);
          if (kept) return answer(db, row.grant_id, kept.tokens);
          return oauthError(
            400,
            "invalid_grant",
            "This refresh token was just used; use its successor.",
          );
        }
        // A refresh token used again after its grace: someone else holds it. The grant goes.
        db.run('UPDATE "grant" SET revoked_at = ? WHERE id = ?', iso(now()), row.grant_id);
        log.warn("auth.refresh_reused", { grant: row.grant_id });
        return oauthError(
          400,
          "invalid_grant",
          "The refresh token was used before; sign in again.",
        );
      }
      const tokens = issue(db, row.grant_id);
      db.run(
        "UPDATE token SET used_at = ?, successor_hash = ? WHERE hash = ?",
        iso(now()),
        hashSecret(tokens.refresh),
        hash,
      );
      forgetOld();
      recent.set(hash, { tokens, at: now() });
      return answer(db, row.grant_id, tokens);
    });
  };

  /** The client a grant is for. */
  const grantClient = (db: LedgerDb, grantId: string): string | undefined =>
    db.get<{ client_id: string }>('SELECT client_id FROM "grant" WHERE id = ?', grantId)?.client_id;

  const grantLiveIn = (
    db: LedgerDb,
    grantId: string,
    options: { readonly anyStatus?: boolean } = {},
  ): boolean => {
    // An operator's credential is checked by asking the operator, by the binding's watch.
    if (grantId.startsWith("credential:")) return true;
    const row = db.get<{ revoked_at: string | null; status: string }>(
      'SELECT g.revoked_at, a.status FROM "grant" g JOIN account a ON a.id = g.account_id WHERE g.id = ?',
      grantId,
    );
    return (
      row !== undefined &&
      row.revoked_at === null &&
      (options.anyStatus === true || row.status === "active")
    );
  };

  return {
    verificationUri,

    device(form) {
      if (form.get("client_id") !== CLI_CLIENT_ID) {
        return oauthError(401, "invalid_client", "Only the Mostra CLI uses the device grant here.");
      }
      const scope = form.get("scope") ?? "mostra";
      if (!scope.split(" ").every((part) => part === "mostra" || part === "offline_access")) {
        return oauthError(400, "invalid_scope", "The only scope is mostra.");
      }
      const deviceCode = secret();
      const code = userCode();
      const instance = form.get("mostra_instance") ?? undefined;
      const name = (form.get("mostra_name") ?? "").slice(0, 128) || "Mostra instance";
      const state: DeviceState = {
        userCode: code,
        status: "pending",
        name,
        ...(instance !== undefined ? { instance } : {}),
        ...(form.get("mostra_default") === "1" ? { makeDefault: true } : {}),
      };
      directory.write((db) =>
        db.run(
          "INSERT INTO token (hash, kind, expires_at, data_json) VALUES (?, 'device', ?, ?)",
          hashSecret(deviceCode),
          iso(now() + DEVICE_TTL_MS),
          JSON.stringify(state),
        ),
      );
      const shown = `${code.slice(0, 4)}-${code.slice(4)}`;
      log.info("auth.device_started", {});
      return {
        device_code: deviceCode,
        user_code: shown,
        verification_uri: verificationUri,
        verification_uri_complete: `${verificationUri}?user_code=${shown}`,
        expires_in: Math.floor(DEVICE_TTL_MS / 1000),
        interval: DEVICE_INTERVAL_S,
      };
    },

    token(form) {
      const grantType = form.get("grant_type");
      const clientId = form.get("client_id") ?? "";
      if (grantType === "authorization_code") {
        const code = form.get("code") ?? "";
        const hash = hashSecret(code);
        return directory.write((db): TokenAnswer | OAuthError => {
          const row = db.get<{ data_json: string; expires_at: string; used_at: string | null }>(
            "SELECT data_json, expires_at, used_at FROM token WHERE hash = ? AND kind = 'code'",
            hash,
          );
          if (row?.used_at != null) {
            // A code presented again: someone else may hold it, so what it gave is revoked
            // (OAuth 2.1 §4.1.3, RFC 9700 §4.5.3).
            const spent = JSON.parse(row.data_json) as CodeGrant & { readonly grantId?: string };
            if (spent.grantId !== undefined) {
              db.run(
                'UPDATE "grant" SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
                iso(now()),
                spent.grantId,
              );
              log.warn("auth.code_reused", { grant: spent.grantId });
            }
            return oauthError(400, "invalid_grant", "The code is unknown, used or expired.");
          }
          // Spent at its first presentation, whatever comes of it: a code works once. The row is
          // kept (as a hash) until it is long expired, so a second presentation is recognized.
          // Code rows only: a refresh token sent as a code is no code, and is left alone.
          db.run("UPDATE token SET used_at = ? WHERE hash = ? AND kind = 'code'", iso(now()), hash);
          if (!row || Date.parse(row.expires_at) <= now()) {
            return oauthError(400, "invalid_grant", "The code is unknown, used or expired.");
          }
          const grant = JSON.parse(row.data_json) as CodeGrant;
          if (grant.viewerSignin !== undefined) {
            return oauthError(
              400,
              "invalid_grant",
              "This code is a page's sign-in, not a client's.",
            );
          }
          if (grant.clientId !== clientId) {
            return oauthError(400, "invalid_grant", "The code was issued to another client.");
          }
          // Required when the authorization request named it (OAuth 2.1 §4.1.3), and the same.
          const redirectUri = form.get("redirect_uri");
          if (
            (redirectUri === null && grant.redirectGiven !== false) ||
            (redirectUri !== null && redirectUri !== grant.redirectUri)
          ) {
            return oauthError(
              400,
              "invalid_grant",
              "redirect_uri isn't the one the code was issued for.",
            );
          }
          if (!pkceMatches(form.get("code_verifier") ?? "", grant.challenge)) {
            return oauthError(400, "invalid_grant", "The PKCE code_verifier doesn't match.");
          }
          const resource = form.get("resource");
          if (resource !== null && canonicalResource(resource) !== grant.resource) {
            return oauthError(
              400,
              "invalid_target",
              "resource isn't the one the code was issued for.",
            );
          }
          const grantId = `grt_${randomBytes(16).toString("hex")}`;
          db.run(
            'INSERT INTO "grant" (id, account_id, client_id, scope, resource, link_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
            grantId,
            grant.accountId,
            grant.clientId,
            grant.scope,
            grant.resource,
            iso(now()),
          );
          db.run(
            "UPDATE token SET data_json = ? WHERE hash = ? AND kind = 'code'",
            JSON.stringify({ ...grant, grantId }),
            hash,
          );
          log.info("auth.code_redeemed", { client: grant.clientId, grant: grantId });
          return answer(db, grantId, issue(db, grantId));
        });
      }
      if (grantType === "refresh_token") return refresh(form, clientId);
      if (clientId !== CLI_CLIENT_ID) {
        return oauthError(401, "invalid_client", "Unknown client.");
      }
      if (grantType === DEVICE_GRANT) {
        const deviceCode = form.get("device_code") ?? "";
        const hash = hashSecret(deviceCode);
        return directory.write((db): TokenAnswer | OAuthError => {
          const row = deviceRow(db, hash);
          if (!row) return oauthError(400, "invalid_grant", "Unknown device code.");
          if (Date.parse(row.expires_at) <= now()) {
            return oauthError(400, "expired_token", "The code expired; sign in again.");
          }
          const state = JSON.parse(row.data_json) as DeviceState;
          if (state.status === "denied") {
            return oauthError(400, "access_denied", "The sign-in was refused.");
          }
          if (state.status === "pending") {
            const tooSoon =
              state.lastPollAt !== undefined &&
              now() - state.lastPollAt < DEVICE_INTERVAL_S * 1000 - 250;
            db.run(
              "UPDATE token SET data_json = ? WHERE hash = ?",
              JSON.stringify({ ...state, lastPollAt: now() }),
              hash,
            );
            return tooSoon
              ? oauthError(400, "slow_down", "Poll less often.")
              : oauthError(400, "authorization_pending", "Waiting for the person to approve.");
          }
          // Approved: one grant, once. The device code is spent here.
          const account = state.accountId as string;
          const home = homeFor(db, account);
          const link = linkFor(db, account, home, state.instance, state.name ?? "Mostra instance");
          // `mostra login --default` makes this instance the account's default (D165 item 1b):
          // chat-host authoring goes to it. One default per account (a unique index).
          if (state.makeDefault === true) {
            db.run(
              "UPDATE instance_link SET is_default = 0 WHERE account_id = ? AND id != ?",
              account,
              link,
            );
            db.run("UPDATE instance_link SET is_default = 1 WHERE id = ?", link);
          }
          const grantId = `grt_${randomBytes(16).toString("hex")}`;
          db.run(
            'INSERT INTO "grant" (id, account_id, client_id, scope, resource, link_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            grantId,
            account,
            CLI_CLIENT_ID,
            "mostra",
            `${config.apiOrigin}/host`,
            link,
            iso(now()),
          );
          db.run("DELETE FROM token WHERE hash = ?", hash);
          const tokens = issue(db, grantId);
          setImmediate(() =>
            options.linked?.({ homeId: home, linkId: link, name: state.name ?? "" }),
          );
          log.info("auth.linked", { account, home, link });
          return answer(db, grantId, tokens);
        });
      }
      return oauthError(
        400,
        "unsupported_grant_type",
        "Use authorization_code, refresh_token or the device grant.",
      );
    },

    revoke(form) {
      const presented = form.get("token") ?? "";
      const hash = hashSecret(presented);
      directory.write((db) => {
        const row = db.get<{ grant_id: string | null }>(
          "SELECT grant_id FROM token WHERE hash = ?",
          hash,
        );
        if (row?.grant_id) {
          db.run(
            'UPDATE "grant" SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
            iso(now()),
            row.grant_id,
          );
          log.info("auth.revoked", { grant: row.grant_id });
        }
      });
    },

    authenticate(bearer) {
      if (bearer.length < 20 || bearer.length > 200) return undefined;
      const hash = hashSecret(bearer);
      return directory.read((db) => {
        const row = db.get<{
          hash: string;
          expires_at: string;
          grant_id: string;
          account_id: string;
          link_id: string | null;
          name: string | null;
          resource: string;
          client_id: string;
          scope: string;
        }>(
          `SELECT t.hash, t.expires_at, t.grant_id, g.account_id, g.link_id, a.name, g.resource, g.client_id, g.scope
             FROM token t JOIN "grant" g ON g.id = t.grant_id JOIN account a ON a.id = g.account_id
            WHERE t.hash = ? AND t.kind = 'access'`,
          hash,
        );
        if (!row) return undefined;
        // Constant-time on what was found, though the lookup was by hash already.
        if (!timingSafeEqual(Buffer.from(row.hash), Buffer.from(hash))) return undefined;
        const expiresAt = Date.parse(row.expires_at);
        // A suspended account's token still names it, so its caller hears "suspended" (403)
        // rather than "sign in again", and the operator's later word can lift it (D165 item 9).
        if (expiresAt <= now() || !grantLiveIn(db, row.grant_id, { anyStatus: true }))
          return undefined;
        const home = db.get<{ id: string }>(
          "SELECT id FROM home WHERE owner_account_id = ?",
          row.account_id,
        );
        // An MCP client's account may have no home yet: it gets one at its first hosted call.
        if (!home && row.resource.endsWith("/host")) return undefined;
        return {
          resource: row.resource,
          clientId: row.client_id,
          scope: row.scope,
          accountId: row.account_id,
          accountName: row.name ?? undefined,
          grantId: row.grant_id,
          homeId: home?.id ?? "",
          linkId: row.link_id ?? undefined,
          expiresAt,
        };
      });
    },

    decideFor(input) {
      const wanted = normalizeUserCode(input.code);
      return directory.write((db) => {
        const rows = db.all<{ hash: string; data_json: string }>(
          "SELECT hash, data_json FROM token WHERE kind = 'device' AND expires_at > ?",
          iso(now()),
        );
        const row = rows.find(
          (candidate) => (JSON.parse(candidate.data_json) as DeviceState).userCode === wanted,
        );
        if (!row) return { ok: false as const, reason: "That code is unknown or has expired." };
        const state = JSON.parse(row.data_json) as DeviceState;
        if (state.status !== "pending")
          return { ok: false as const, reason: "That code was already used." };
        db.run(
          "UPDATE token SET data_json = ? WHERE hash = ?",
          JSON.stringify(
            input.approve
              ? { ...state, status: "approved", accountId: input.accountId }
              : { ...state, status: "denied" },
          ),
          row.hash,
        );
        if (input.approve) {
          db.run(
            "INSERT INTO consent (account_id, client_id, granted_at) VALUES (?, ?, ?) ON CONFLICT (account_id, client_id) DO UPDATE SET revoked_at = NULL",
            input.accountId,
            CLI_CLIENT_ID,
            iso(now()),
          );
        }
        return { ok: true as const };
      });
    },

    async resolveAccount(identity, steps) {
      const verdict = options.operator
        ? await options.operator.resolve(identity, steps)
        : ({ default: true } as const);
      if (verdict === "unavailable") return { kind: "unavailable" };
      if ("default" in verdict) {
        const accountId = directory.write((db) => accountFor(db, identity));
        const status = directory.read(
          (db) =>
            db.get<{ status: string }>("SELECT status FROM account WHERE id = ?", accountId)
              ?.status,
        );
        if (status === "suspended") return { kind: "suspended" };
        return { kind: "account", accountId, name: identity.name };
      }
      if ("step" in verdict) return { kind: "step", url: verdict.step.url };
      if ("refused" in verdict) return { kind: "refused", message: verdict.refused.message };
      directory.write((db) =>
        operatorAccount(db, identity, verdict.account, verdict.name, verdict.status),
      );
      if (verdict.status === "suspended") return { kind: "suspended" };
      return { kind: "account", accountId: verdict.account, name: verdict.name ?? identity.name };
    },

    accountName(accountId) {
      return directory.read((db) => {
        const row = db.get<{ name: string | null; provider: string | null }>(
          `SELECT a.name, (SELECT i.provider FROM identity i WHERE i.account_id = a.id
              ORDER BY i.linked_at LIMIT 1) AS provider FROM account a WHERE a.id = ?`,
          accountId,
        );
        return {
          ...(row?.name ? { name: row.name } : {}),
          ...(row?.provider ? { provider: row.provider } : {}),
        };
      });
    },

    issueCode(grant) {
      const code = secret();
      directory.write((db) => {
        // Codes are kept a while after use to recognize a second presentation, then dropped.
        db.run(
          "DELETE FROM token WHERE kind = 'code' AND expires_at < ?",
          iso(now() - CODE_KEPT_MS),
        );
        db.run(
          "INSERT INTO token (hash, kind, expires_at, data_json) VALUES (?, 'code', ?, ?)",
          hashSecret(code),
          iso(now() + CODE_TTL_MS),
          JSON.stringify(grant),
        );
      });
      return code;
    },

    redeemViewerCode(input) {
      const hash = hashSecret(input.code);
      return directory.write((db) => {
        const row = db.get<{ data_json: string; expires_at: string }>(
          "SELECT data_json, expires_at FROM token WHERE hash = ? AND kind = 'code'",
          hash,
        );
        db.run("DELETE FROM token WHERE hash = ?", hash);
        if (!row || Date.parse(row.expires_at) <= now()) {
          return { refused: "The sign-in code is unknown, used or expired." };
        }
        const grant = JSON.parse(row.data_json) as CodeGrant;
        if (grant.viewerSignin === undefined || grant.viewerSignin !== input.viewerSignin) {
          return { refused: "This sign-in code was started for another page." };
        }
        if (grant.clientId !== input.clientId) {
          return { refused: "This sign-in code was issued to another shell." };
        }
        if (!pkceMatches(input.verifier, grant.challenge)) {
          return { refused: "The sign-in's PKCE verifier doesn't match." };
        }
        return { accountId: grant.accountId };
      });
    },

    credentialSession(input) {
      return directory.write((db) => {
        db.run(
          "INSERT INTO account (id, name, status, created_at) VALUES (?, NULL, 'active', ?) ON CONFLICT (id) DO NOTHING",
          input.account,
          iso(now()),
        );
        const home = homeFor(db, input.account);
        let link = db.get<{ link_id: string }>(
          "SELECT link_id FROM credential_link WHERE account_id = ? AND subject = ?",
          input.account,
          input.subject,
        )?.link_id;
        // Only a binding makes the key's instance link: a key used on /mcp or /files first names
        // none, so no link that never binds takes the account's default (Fable review, 3).
        if (link === undefined && input.link) {
          link = linkFor(
            db,
            input.account,
            home,
            undefined,
            `Service key ${input.subject}`.slice(0, 128),
          );
          db.run(
            "INSERT INTO credential_link (account_id, subject, link_id) VALUES (?, ?, ?)",
            input.account,
            input.subject,
            link,
          );
        }
        const name = db.get<{ name: string | null }>(
          "SELECT name FROM account WHERE id = ?",
          input.account,
        )?.name;
        return {
          resource: input.resource,
          clientId: "operator",
          scope: "mostra",
          accountId: input.account,
          accountName: name ?? undefined,
          // Not a grant of this server: the operator is asked again while the binding stays open.
          grantId: `credential:${input.account}:${input.subject}`,
          homeId: home,
          linkId: link,
          expiresAt: now() + accessTtlMs,
        };
      });
    },

    refreshAccount(refreshToken) {
      return directory.read(
        (db) =>
          db.get<{ account_id: string }>(
            "SELECT g.account_id FROM token t JOIN \"grant\" g ON g.id = t.grant_id WHERE t.hash = ? AND t.kind = 'refresh'",
            hashSecret(refreshToken),
          )?.account_id,
      );
    },

    accountStatus(accountId) {
      return directory.read((db) =>
        db.get<{ status: string }>("SELECT status FROM account WHERE id = ?", accountId)?.status ===
        "suspended"
          ? "suspended"
          : "active",
      );
    },

    setAccountStatus(accountId, status) {
      directory.write((db) =>
        db.run(
          "UPDATE account SET status = ? WHERE id = ? AND status != ?",
          status,
          accountId,
          status,
        ),
      );
    },

    linkState(linkId, makeDefault) {
      return directory.write((db) => {
        if (makeDefault) {
          const owner = db.get<{ account_id: string }>(
            "SELECT account_id FROM instance_link WHERE id = ?",
            linkId,
          );
          if (owner) {
            db.run(
              "UPDATE instance_link SET is_default = 0 WHERE account_id = ? AND id != ?",
              owner.account_id,
              linkId,
            );
            db.run("UPDATE instance_link SET is_default = 1 WHERE id = ?", linkId);
          }
        }
        const row = db.get<{ is_default: number }>(
          "SELECT is_default FROM instance_link WHERE id = ?",
          linkId,
        );
        return { default: row?.is_default === 1 };
      });
    },

    ensureHome(accountId) {
      return directory.write((db) => homeFor(db, accountId));
    },

    consented(accountId, clientId) {
      return directory.read(
        (db) =>
          db.get(
            "SELECT 1 FROM consent WHERE account_id = ? AND client_id = ? AND revoked_at IS NULL",
            accountId,
            clientId,
          ) !== undefined,
      );
    },

    consent(accountId, clientId) {
      directory.write((db) =>
        db.run(
          "INSERT INTO consent (account_id, client_id, granted_at) VALUES (?, ?, ?) ON CONFLICT (account_id, client_id) DO UPDATE SET revoked_at = NULL, granted_at = excluded.granted_at",
          accountId,
          clientId,
          iso(now()),
        ),
      );
    },

    grantLive(grantId) {
      return directory.read((db) => grantLiveIn(db, grantId));
    },

    pendingCode(code) {
      const wanted = normalizeUserCode(code);
      return directory.read((db) => {
        const rows = db.all<{ data_json: string; expires_at: string }>(
          "SELECT data_json, expires_at FROM token WHERE kind = 'device' AND expires_at > ?",
          iso(now()),
        );
        const row = rows.find(
          (candidate) => (JSON.parse(candidate.data_json) as DeviceState).userCode === wanted,
        );
        if (!row) return { ok: false as const, reason: "That code is unknown or has expired." };
        const state = JSON.parse(row.data_json) as DeviceState;
        return state.status === "pending"
          ? { ok: true as const }
          : { ok: false as const, reason: "That code was already used." };
      });
    },

    decide(input) {
      const wanted = normalizeUserCode(input.code);
      return directory.write((db) => {
        const rows = db.all<{ hash: string; data_json: string }>(
          "SELECT hash, data_json FROM token WHERE kind = 'device' AND expires_at > ?",
          iso(now()),
        );
        const row = rows.find(
          (candidate) => (JSON.parse(candidate.data_json) as DeviceState).userCode === wanted,
        );
        if (!row) return { ok: false as const, reason: "That code is unknown or has expired." };
        const state = JSON.parse(row.data_json) as DeviceState;
        if (state.status !== "pending")
          return { ok: false as const, reason: "That code was already used." };
        if (!input.approve) {
          db.run(
            "UPDATE token SET data_json = ? WHERE hash = ?",
            JSON.stringify({ ...state, status: "denied" }),
            row.hash,
          );
          return { ok: true as const };
        }
        const account = accountFor(db, input.identity);
        db.run(
          "INSERT INTO consent (account_id, client_id, granted_at) VALUES (?, ?, ?) ON CONFLICT (account_id, client_id) DO UPDATE SET revoked_at = NULL",
          account,
          CLI_CLIENT_ID,
          iso(now()),
        );
        db.run(
          "UPDATE token SET data_json = ? WHERE hash = ?",
          JSON.stringify({ ...state, status: "approved", accountId: account }),
          row.hash,
        );
        return { ok: true as const };
      });
    },
  };
}
