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
import type { Ledger, LedgerDb } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import type { RemoteServerConfig } from "./config.ts";

/** The CLI's client ID: a first-party public client (§18.5). */
export const CLI_CLIENT_ID = "mostra-cli";

/** The device grant's type (RFC 8628 §3.4). */
export const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const DEVICE_TTL_MS = 10 * 60 * 1000;
const DEVICE_INTERVAL_S = 5;
const ROTATION_GRACE_MS = 30_000;

/** User codes: eight letters a person can't confuse (RFC 8628 §6.1), shown as `ABCD-EFGH`. */
const USER_CODE_LETTERS = "BCDFGHJKLMNPQRSTVWXZ";

/** What a valid access token names. */
export interface Authenticated {
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
  readonly mostra_instance: string;
  /** Whether this instance is the account's default instance (D165 item 1b). */
  readonly mostra_default: boolean;
  /** The account's hosted home. */
  readonly mostra_home: string;
}

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
  readonly now?: () => number;
  /** How long an access token lasts; an hour unless tests shorten it. */
  readonly accessTtlMs?: number;
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
}

function oauthError(status: number, error: string, description: string): OAuthError {
  return { status, error, description };
}

/** Creates the authorization server over the server's directory. */
export function createAuthorization(options: AuthorizationOptions): Authorization {
  const { directory, config, log } = options;
  const now = options.now ?? (() => Date.now());
  const accessTtlMs = options.accessTtlMs ?? ACCESS_TTL_MS;
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
    }>(
      `SELECT g.account_id, g.link_id, a.name, l.is_default, l.home_id
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
      scope: "mostra",
      mostra_account: { id: row.account_id, ...(row.name !== null ? { name: row.name } : {}) },
      mostra_instance: row.link_id ?? "",
      mostra_default: row.is_default === 1,
      mostra_home: row.home_id ?? "",
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
    for (const [hash, entry] of recent)
      if (now() - entry.at > ROTATION_GRACE_MS) recent.delete(hash);
  };

  const grantLiveIn = (db: LedgerDb, grantId: string): boolean => {
    const row = db.get<{ revoked_at: string | null; status: string }>(
      'SELECT g.revoked_at, a.status FROM "grant" g JOIN account a ON a.id = g.account_id WHERE g.id = ?',
      grantId,
    );
    return row !== undefined && row.revoked_at === null && row.status === "active";
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
      if (form.get("client_id") !== CLI_CLIENT_ID) {
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
      if (grantType === "refresh_token") {
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
          if (!row || !grantLiveIn(db, row.grant_id)) {
            return oauthError(
              400,
              "invalid_grant",
              "The refresh token isn't valid; sign in again.",
            );
          }
          if (Date.parse(row.expires_at) <= now()) {
            return oauthError(400, "invalid_grant", "The refresh token expired; sign in again.");
          }
          if (row.used_at !== null) {
            const used = Date.parse(row.used_at);
            forgetOld();
            if (now() - used <= ROTATION_GRACE_MS) {
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
      }
      return oauthError(400, "unsupported_grant_type", "Use the device grant or a refresh token.");
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
        }>(
          `SELECT t.hash, t.expires_at, t.grant_id, g.account_id, g.link_id, a.name
             FROM token t JOIN "grant" g ON g.id = t.grant_id JOIN account a ON a.id = g.account_id
            WHERE t.hash = ? AND t.kind = 'access'`,
          hash,
        );
        if (!row) return undefined;
        // Constant-time on what was found, though the lookup was by hash already.
        if (!timingSafeEqual(Buffer.from(row.hash), Buffer.from(hash))) return undefined;
        const expiresAt = Date.parse(row.expires_at);
        if (expiresAt <= now() || !grantLiveIn(db, row.grant_id)) return undefined;
        const home = db.get<{ id: string }>(
          "SELECT id FROM home WHERE owner_account_id = ?",
          row.account_id,
        );
        if (!home) return undefined;
        return {
          accountId: row.account_id,
          accountName: row.name ?? undefined,
          grantId: row.grant_id,
          homeId: home.id,
          linkId: row.link_id ?? undefined,
          expiresAt,
        };
      });
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
