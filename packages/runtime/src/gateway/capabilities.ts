/**
 * Capability tokens, sessions and frame tickets (D97, D98, HY-03): the gateway's authority over
 * who may use an artifact. Tokens are minted with secrets derived from the home's capability key
 * and stored only as hashes; sessions are stored as hashes of their cookies and bound to the one
 * origin they were issued for; tickets live in memory for 60 seconds and work once. Every check
 * reads the ledger, so a revocation applies to the very next request.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import {
  ALL_SCOPES,
  type CapabilityScope,
  normalizeScopes,
  type Refusal,
  refusal,
  safeEqual,
  TokenId,
} from "@mostra/protocol";
import { appendEvent } from "../interaction/index.ts";
import type { Ledger, LedgerDb } from "../ledger/index.ts";
import type { Log } from "../log.ts";

/** Crockford base32, the alphabet of every Mostra ID body (D77). */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The length of every secret: 26 Crockford characters, 130 bits. */
export const SECRET_LENGTH = 26;

/** How long a frame ticket works (D98). */
export const TICKET_TTL_MS = 60_000;

/** Failed token or ticket attempts a gateway tolerates per minute (D97 item 8). */
export const FAILURE_LIMIT = 30;
const FAILURE_WINDOW_MS = 60_000;

/** How long a session the browser no longer presents is kept: the cookie's own lifetime. */
export const SESSION_MAX_AGE_S: number = 400 * 24 * 60 * 60;

/** How often a session's `last_seen_at` is written at most. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/** Encodes the first 130 bits of `bytes` as 26 Crockford base32 characters. */
function crockford(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5 && out.length < SECRET_LENGTH) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length === SECRET_LENGTH) break;
  }
  return out;
}

/** A fresh random secret: a session cookie, a CSRF token or a ticket (130 bits). */
export function randomSecret(): string {
  return crockford(randomBytes(17));
}

/** The SHA-256 of a secret, as stored (lowercase hex). */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** Whether a value has the shape of a secret, checked before any lookup. */
export function looksLikeSecret(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === SECRET_LENGTH &&
    /^[0-9A-HJKMNP-TV-Z]+$/.test(value)
  );
}

/**
 * Reads the home's capability key (`<home>/keys/capability`, 32 random bytes, mode 0600),
 * creating it when it doesn't exist. A key that can't be read is replaced: links minted under it
 * still verify by their hashes; only showing them again needs the key (D97 item 2).
 */
export function capabilityKey(home: string, log: Log): Buffer {
  const dir = join(home, "keys");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, "capability");
  try {
    const key = readFileSync(file);
    if (key.length === 32) return key;
    log.warn("gateway.key_replaced", { reason: `the key file has ${key.length} bytes` });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") log.warn("gateway.key_replaced", { reason: code ?? "unreadable" });
  }
  const key = randomBytes(32);
  // Written aside, synced and renamed, so a crash never leaves a short key behind.
  const aside = `${file}.${process.pid}.tmp`;
  const fd = openSync(aside, "w", 0o600);
  try {
    writeSync(fd, key);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(aside, file);
  chmodSync(file, 0o600);
  return key;
}

/** What a token grants (DATA_MODEL §3 `token`). */
export interface Grant {
  readonly tokenId: string;
  readonly artifactId: string;
  readonly scopes: readonly CapabilityScope[];
  /** When it stops working, if it does. */
  readonly expiresAt?: string;
  /** The version number its link names, if it pins one. */
  readonly pinnedVersion?: number;
  /** Whether it is the artifact's default link. */
  readonly isDefault: boolean;
}

/** A token with its secret, just minted or derived again. */
export interface MintedToken extends Grant {
  readonly secret: string;
}

/** A session as a request presents it, resolved. */
export interface ResolvedSession {
  /** The session's ID (the SHA-256 of its cookie). */
  readonly id: string;
  readonly csrf: string;
  /** The version a frame session entered (D98 item 5). */
  readonly versionId?: string;
  readonly grant: Grant;
}

/** What a redeemed frame ticket carries. */
export interface TicketGrant {
  readonly tokenId: string;
  readonly artifactId: string;
  readonly versionId: string;
  /** The artifact origin the ticket is good for. */
  readonly origin: string;
  /** The shell origin that minted it, which the frame's bridge talks to. */
  readonly shellOrigin: string;
}

interface TokenRow {
  id: string;
  secret_hash: string;
  artifact_id: string;
  scopes_json: string;
  expires_at: string | null;
  revoked_at: string | null;
  is_default: number;
  pinned_version: number | null;
}

interface SessionRow {
  id: string;
  token_id: string;
  origin: string;
  csrf: string;
  version_id: string | null;
}

const grantOf = (row: TokenRow): Grant => ({
  tokenId: row.id,
  artifactId: row.artifact_id,
  scopes: JSON.parse(row.scopes_json) as CapabilityScope[],
  ...(row.expires_at !== null ? { expiresAt: row.expires_at } : {}),
  ...(row.pinned_version !== null ? { pinnedVersion: row.pinned_version } : {}),
  isDefault: row.is_default === 1,
});

/** Options for {@link Capabilities}. */
export interface CapabilitiesOptions {
  readonly ledger: Ledger;
  readonly log: Log;
  /** The home's capability key. */
  readonly key: Buffer;
  /** The clock, in milliseconds since the epoch. */
  readonly now: () => number;
}

/** The capability authority of one instance. */
export class Capabilities {
  readonly #ledger: Ledger;
  readonly #log: Log;
  readonly #key: Buffer;
  readonly #now: () => number;
  readonly #tickets = new Map<string, TicketGrant & { readonly expires: number }>();
  readonly #failures: number[] = [];
  readonly #touched = new Map<string, number>();

  constructor(options: CapabilitiesOptions) {
    this.#ledger = options.ledger;
    this.#log = options.log;
    this.#key = options.key;
    this.#now = options.now;
  }

  /** Runs `fn` in the caller's transaction, or in a new one. */
  #tx<T>(db: LedgerDb | undefined, fn: (db: LedgerDb) => T): T {
    return db ? fn(db) : this.#ledger.write(fn);
  }

  /** The secret of a token, derived from its ID under the home's key (D97 item 2). */
  secretOf(tokenId: string): string {
    return crockford(
      createHmac("sha256", this.#key).update(`mostra capability ${tokenId}`).digest(),
    );
  }

  #iso(ms: number): string {
    return new Date(ms).toISOString();
  }

  #live(row: TokenRow): boolean {
    return (
      row.revoked_at === null &&
      (row.expires_at === null || Date.parse(row.expires_at) > this.#now())
    );
  }

  #insert(
    db: LedgerDb,
    input: {
      readonly artifactId: string;
      readonly scopes: readonly CapabilityScope[];
      readonly expiresAt?: string | undefined;
      readonly pinnedVersion?: number | undefined;
      readonly isDefault: boolean;
    },
  ): MintedToken {
    const tokenId = TokenId.create();
    const secret = this.secretOf(tokenId);
    const scopes = normalizeScopes(input.scopes);
    db.run(
      "INSERT INTO token (id, secret_hash, artifact_id, scopes_json, viewer_id, expires_at, revoked_at, created_at, is_default, pinned_version) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?)",
      tokenId,
      hashSecret(secret),
      input.artifactId,
      JSON.stringify(scopes),
      input.expiresAt ?? null,
      this.#iso(this.#now()),
      input.isDefault ? 1 : 0,
      input.pinnedVersion ?? null,
    );
    return {
      tokenId,
      secret,
      artifactId: input.artifactId,
      scopes,
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(input.pinnedVersion !== undefined ? { pinnedVersion: input.pinnedVersion } : {}),
      isDefault: input.isDefault,
    };
  }

  /** Mints a new token (`view/url`), in the caller's transaction when it passes one. */
  mint(
    input: {
      readonly artifactId: string;
      readonly scopes?: readonly CapabilityScope[] | undefined;
      readonly ttlMs?: number | undefined;
      readonly pinnedVersion?: number | undefined;
    },
    within?: LedgerDb,
  ): MintedToken {
    return this.#tx(within, (db) =>
      this.#insert(db, {
        artifactId: input.artifactId,
        scopes: input.scopes ?? ALL_SCOPES,
        expiresAt: input.ttlMs === undefined ? undefined : this.#iso(this.#now() + input.ttlMs),
        pinnedVersion: input.pinnedVersion,
        isDefault: false,
      }),
    );
  }

  /**
   * The artifact's default link (D97 item 3): the live default token, shown again from its
   * derived secret, or a new one. A default whose secret the current key no longer derives (the
   * key was replaced) stays valid for whoever holds it, and a new default takes its place.
   */
  defaultLink(artifactId: string): MintedToken {
    return this.#ledger.write((db) => {
      const row = db.get<TokenRow>(
        "SELECT * FROM token WHERE artifact_id = ? AND is_default = 1",
        artifactId,
      );
      if (row) {
        const secret = this.secretOf(row.id);
        if (safeEqual(hashSecret(secret), row.secret_hash)) return { ...grantOf(row), secret };
        db.run("UPDATE token SET is_default = 0 WHERE id = ?", row.id);
        this.#log.warn("gateway.default_link_replaced", { artifactId, tokenId: row.id });
      }
      return this.#insert(db, { artifactId, scopes: ALL_SCOPES, isDefault: true });
    });
  }

  /** A token's grant, live or not; `undefined` when no such token exists. */
  grant(tokenId: string): (Grant & { readonly live: boolean }) | undefined {
    const row = this.#ledger.read((db) =>
      db.get<TokenRow>("SELECT * FROM token WHERE id = ?", tokenId),
    );
    return row ? { ...grantOf(row), live: this.#live(row) } : undefined;
  }

  /** The token's link again, from its derived secret, when the current key still derives it. */
  reveal(tokenId: string): MintedToken | undefined {
    const row = this.#ledger.read((db) =>
      db.get<TokenRow>("SELECT * FROM token WHERE id = ?", tokenId),
    );
    if (!row) return undefined;
    const secret = this.secretOf(row.id);
    return safeEqual(hashSecret(secret), row.secret_hash) ? { ...grantOf(row), secret } : undefined;
  }

  /** Revokes a token and its sessions (`view/revoke`); revoking a revoked token is a no-op. */
  revoke(tokenId: string, within?: LedgerDb): "revoked" | "already" | "unknown" {
    return this.#tx(within, (db) => {
      const row = db.get<TokenRow>("SELECT * FROM token WHERE id = ?", tokenId);
      if (!row) return "unknown";
      if (row.revoked_at !== null) return "already";
      // Its sessions stay, so they keep answering 410 rather than 401 (FAILURE_MODEL §8).
      db.run(
        "UPDATE token SET revoked_at = ?, is_default = 0 WHERE id = ?",
        this.#iso(this.#now()),
        tokenId,
      );
      appendEvent(db, {
        artifactId: row.artifact_id,
        type: "token.revoked",
        payload: { tokenId, reason: "revoked" },
      });
      return "revoked";
    });
  }

  /**
   * Replaces a live token with a new one of the same artifact, scopes, expiry and pinned version,
   * in one transaction (`view/rotate`, D97 item 6). Returns `undefined` for an unknown token and
   * `"dead"` for a revoked or expired one.
   */
  rotate(tokenId: string, within?: LedgerDb): MintedToken | "dead" | undefined {
    return this.#tx(within, (db) => {
      const row = db.get<TokenRow>("SELECT * FROM token WHERE id = ?", tokenId);
      if (!row) return undefined;
      if (!this.#live(row)) return "dead";
      const grant = grantOf(row);
      // The old token stops being the default first: the index allows one default per artifact.
      db.run(
        "UPDATE token SET revoked_at = ?, is_default = 0 WHERE id = ?",
        this.#iso(this.#now()),
        tokenId,
      );
      const minted = this.#insert(db, {
        artifactId: grant.artifactId,
        scopes: grant.scopes,
        expiresAt: grant.expiresAt,
        pinnedVersion: grant.pinnedVersion,
        isDefault: grant.isDefault,
      });
      db.run("UPDATE token SET replaced_by = ? WHERE id = ?", minted.tokenId, tokenId);
      appendEvent(db, {
        artifactId: grant.artifactId,
        type: "token.revoked",
        payload: { tokenId, reason: "rotated", replacedBy: minted.tokenId },
      });
      return minted;
    });
  }

  /** A refusal, with its `Retry-After` seconds, while too many attempts failed in the last minute (D97 item 8). */
  limited(): (Refusal & { readonly retryAfter: number }) | undefined {
    const now = this.#now();
    while (this.#failures.length > 0 && (this.#failures[0] ?? 0) <= now - FAILURE_WINDOW_MS) {
      this.#failures.shift();
    }
    if (this.#failures.length < FAILURE_LIMIT) return undefined;
    const retry = Math.max(
      1,
      Math.ceil(((this.#failures[0] ?? now) + FAILURE_WINDOW_MS - now) / 1000),
    );
    return {
      ...refusal("MOSTRA_HYGIENE_RATE_LIMITED", `Too many failed attempts; retry in ${retry} s.`),
      retryAfter: retry,
    };
  }

  #fail(): void {
    this.#failures.push(this.#now());
  }

  /**
   * Checks a capability token presented for `artifactId`: an unknown secret, or one for another
   * artifact, is `MOSTRA_HYGIENE_TOKEN_INVALID`; a revoked or expired one `_TOKEN_REVOKED`. Every
   * failure counts towards the rate limit.
   */
  presentToken(secret: unknown, artifactId: string): Grant | Refusal {
    if (!looksLikeSecret(secret)) {
      this.#fail();
      return refusal(
        "MOSTRA_HYGIENE_TOKEN_INVALID",
        "The capability token isn't one Mostra minted.",
      );
    }
    const row = this.#ledger.read((db) =>
      db.get<TokenRow>("SELECT * FROM token WHERE secret_hash = ?", hashSecret(secret)),
    );
    if (!row || row.artifact_id !== artifactId) {
      this.#fail();
      return refusal(
        "MOSTRA_HYGIENE_TOKEN_INVALID",
        "No capability token in this home matches this link.",
      );
    }
    if (!this.#live(row)) {
      this.#fail();
      return refusal(
        "MOSTRA_HYGIENE_TOKEN_REVOKED",
        row.revoked_at !== null ? "This link was revoked." : "This link has expired.",
      );
    }
    return grantOf(row);
  }

  /** Starts a session for a grant on one origin; returns the cookie secret and CSRF token. */
  createSession(input: {
    readonly tokenId: string;
    readonly origin: string;
    readonly versionId?: string;
  }): {
    readonly cookie: string;
    readonly csrf: string;
    readonly id: string;
  } {
    const cookie = randomSecret();
    const csrf = randomSecret();
    const id = hashSecret(cookie);
    const now = this.#iso(this.#now());
    this.#ledger.write((db) =>
      db.run(
        "INSERT INTO session (id, token_id, origin, mode, csrf, version_id, created_at, last_seen_at) VALUES (?, ?, ?, 'cookie', ?, ?, ?, ?)",
        id,
        input.tokenId,
        input.origin,
        csrf,
        input.versionId ?? null,
        now,
        now,
      ),
    );
    return { cookie, csrf, id };
  }

  /**
   * Resolves the session a request presents on `origin` for `artifactId`. Every candidate cookie
   * value is tried, since another page of the host may have set a cookie of the same name (D98):
   * only a session issued for this origin, whose token is live and grants this artifact, counts.
   */
  session(
    cookies: readonly string[],
    origin: string,
    artifactId: string,
  ): ResolvedSession | Refusal {
    let revoked = false;
    for (const value of cookies) {
      if (!looksLikeSecret(value)) continue;
      const found = this.#ledger.read((db) => {
        const session = db.get<SessionRow>("SELECT * FROM session WHERE id = ?", hashSecret(value));
        if (!session || session.origin !== origin) return undefined;
        const token = db.get<TokenRow>("SELECT * FROM token WHERE id = ?", session.token_id);
        return token && token.artifact_id === artifactId ? { session, token } : undefined;
      });
      if (!found) continue;
      if (!this.#live(found.token)) {
        revoked = true;
        continue;
      }
      this.#touch(found.session.id);
      return {
        id: found.session.id,
        csrf: found.session.csrf,
        ...(found.session.version_id !== null ? { versionId: found.session.version_id } : {}),
        grant: grantOf(found.token),
      };
    }
    return revoked
      ? refusal(
          "MOSTRA_HYGIENE_TOKEN_REVOKED",
          "The link this session came from was revoked or has expired.",
        )
      : refusal(
          "MOSTRA_HYGIENE_SESSION_MISSING",
          "The request carries no session for this origin.",
        );
  }

  /** Records the version a frame session entered (D98 item 5). */
  enterVersion(sessionId: string, versionId: string): void {
    this.#ledger.write((db) =>
      db.run(
        "UPDATE session SET version_id = ?, last_seen_at = ? WHERE id = ?",
        versionId,
        this.#iso(this.#now()),
        sessionId,
      ),
    );
  }

  /** Writes `last_seen_at` at most hourly, so serving files doesn't write the ledger per request. */
  #touch(sessionId: string): void {
    const now = this.#now();
    if (now - (this.#touched.get(sessionId) ?? 0) < TOUCH_INTERVAL_MS) return;
    this.#touched.set(sessionId, now);
    this.#ledger.write((db) =>
      db.run("UPDATE session SET last_seen_at = ? WHERE id = ?", this.#iso(now), sessionId),
    );
  }

  /** Mints a single-use frame ticket (D98 item 3). */
  mintTicket(grant: Omit<TicketGrant, never>): string {
    const ticket = randomSecret();
    this.#sweepTickets();
    this.#tickets.set(hashSecret(ticket), { ...grant, expires: this.#now() + TICKET_TTL_MS });
    return ticket;
  }

  /** Redeems a ticket on `origin`, once; every failure counts towards the rate limit. */
  redeemTicket(ticket: unknown, origin: string): TicketGrant | Refusal {
    this.#sweepTickets();
    const key = looksLikeSecret(ticket) ? hashSecret(ticket) : undefined;
    const entry = key === undefined ? undefined : this.#tickets.get(key);
    if (key !== undefined) this.#tickets.delete(key);
    if (!entry || entry.origin !== origin) {
      this.#fail();
      return refusal(
        "MOSTRA_HYGIENE_TOKEN_INVALID",
        "The frame ticket is unknown, used or expired.",
      );
    }
    const grant = this.grant(entry.tokenId);
    if (!grant?.live) {
      this.#fail();
      return refusal(
        "MOSTRA_HYGIENE_TOKEN_REVOKED",
        "The link behind this frame was revoked or has expired.",
      );
    }
    const { expires: _expires, ...rest } = entry;
    return rest;
  }

  #sweepTickets(): void {
    const now = this.#now();
    for (const [key, entry] of this.#tickets) if (entry.expires <= now) this.#tickets.delete(key);
  }

  /** Removes sessions unseen for longer than their cookie lives; no browser holds them any more. */
  prune(): number {
    const cutoff = this.#iso(this.#now() - SESSION_MAX_AGE_S * 1000);
    return this.#ledger.write(
      (db) => db.run("DELETE FROM session WHERE last_seen_at < ?", cutoff).changes,
    );
  }
}
