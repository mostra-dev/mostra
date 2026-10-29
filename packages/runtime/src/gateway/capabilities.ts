/**
 * Capability tokens, sessions and frame tickets (D97, D98, HY-03): the gateway's authority over
 * who may use an artifact. Tokens are minted with secrets derived from the home's capability key
 * and stored only as hashes; sessions are stored as hashes of their cookies and bound to the one
 * origin they were issued for; tickets live in memory for 60 seconds, work once and only while the
 * shell session that asked for them lives. A link works only at the shell address it was minted
 * for. Every check reads the ledger, so a revocation applies to the very next request.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
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
import { renamePathSync } from "../platform/index.ts";

/** Crockford base32, the alphabet of every Mostra ID body (D77). */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The length of every secret: 26 Crockford characters, 130 bits. */
export const SECRET_LENGTH = 26;

/** How long a frame ticket works (D98). */
export const TICKET_TTL_MS = 60_000;

/** How many frame tickets, and how many stream tickets, a session holds at once (D158 item 5). */
export const TICKETS_PER_SESSION = 8;

/** How often expired tickets are swept at most. */
const SWEEP_INTERVAL_MS = 1_000;

/**
 * Failed capability tokens tolerated per artifact and minute (D97 item 8). Tickets don't count:
 * they are single-use 130-bit secrets that live for a minute, and any page on the host could spend
 * a count by loading an entry URL.
 */
export const FAILURE_LIMIT = 30;
const FAILURE_WINDOW_MS = 60_000;

/** How long a session the browser no longer presents is kept: the cookie's own lifetime. */
export const SESSION_MAX_AGE_S: number = 400 * 24 * 60 * 60;

/** How often a session's `last_seen_at` is written at most. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

/** Whether two origins are on the same scheme and host, whatever their ports. */
function sameHost(a: string, b: string): boolean {
  try {
    const one = new URL(a);
    const two = new URL(b);
    return one.protocol === two.protocol && one.hostname === two.hostname;
  } catch {
    return false;
  }
}

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

/**
 * A session's CSRF token, derived from its cookie (D98 item 2). The ledger holds neither: only
 * the SHA-256 of the cookie (the session's ID) and of the CSRF token, and neither hash leads to
 * the other. Whoever holds the cookie already holds the session, so deriving costs nothing.
 */
export function csrfOf(cookie: string): string {
  return crockford(createHash("sha256").update(`mostra csrf ${cookie}`, "utf8").digest());
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
  renamePathSync(aside, file);
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
  /** The shell origin the link was minted for; it works only there. */
  readonly shellOrigin: string;
  /** The viewer the link acts for (D104); absent: the home's local user. */
  readonly viewerId?: string;
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
  /** How the session authenticates: a cookie, or the frame header of worker mode (D70). */
  readonly mode: "cookie" | "worker";
  readonly grant: Grant;
  /**
   * The viewer the session acts as: its link's viewer (D104), else the one the host's identity
   * port named when the link was exchanged (D143 item 2); absent: the home's local user.
   */
  readonly viewerId?: string;
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
  /** The shell session that asked for it: the ticket works only while that session lives. */
  readonly shellSessionId: string;
  /** The viewer that shell session acts as, which the frame's session acts as too (D143). */
  readonly viewerId?: string | undefined;
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
  shell_origin: string;
  viewer_id: string | null;
}

interface SessionRow {
  id: string;
  token_id: string;
  origin: string;
  mode: "cookie" | "worker";
  csrf: string;
  version_id: string | null;
  viewer_id: string | null;
}

const grantOf = (row: TokenRow): Grant => ({
  tokenId: row.id,
  artifactId: row.artifact_id,
  scopes: JSON.parse(row.scopes_json) as CapabilityScope[],
  ...(row.expires_at !== null ? { expiresAt: row.expires_at } : {}),
  ...(row.pinned_version !== null ? { pinnedVersion: row.pinned_version } : {}),
  isDefault: row.is_default === 1,
  shellOrigin: row.shell_origin,
  ...(row.viewer_id !== null ? { viewerId: row.viewer_id } : {}),
});

/** Options for {@link Capabilities}. */
export interface CapabilitiesOptions {
  readonly ledger: Ledger;
  readonly log: Log;
  /** The home's capability key. */
  readonly key: Buffer;
  /** The clock, in milliseconds since the epoch. */
  readonly now: () => number;
  /**
   * The loopback shell's origin, once the gateway listens: links are minted for it unless the
   * caller names another shell address (a share's, a host's, D158), and work only there.
   */
  readonly shellOrigin: () => string;
  /**
   * Whether the gateway serves a shell at this origin now (the loopback shell, a share's shell
   * face, a host's): a launch ticket is only minted for a link whose address is served.
   */
  readonly servesShell?: (origin: string) => boolean;
}

/** What a stream ticket opens (D158 item 5). */
export type StreamTicketPurpose = "stream" | "socket";

/** The capability authority of one instance. */
export class Capabilities {
  readonly #ledger: Ledger;
  readonly #log: Log;
  readonly #key: Buffer;
  readonly #now: () => number;
  readonly #shellOrigin: () => string;
  readonly #servesShell: (origin: string) => boolean;
  /** Single-use stream and socket tickets (D158 item 5), by the SHA-256 of their secret. */
  readonly #streamTickets = new Map<
    string,
    {
      readonly sessionId: string;
      readonly origin: string;
      readonly artifactId: string;
      readonly purpose: StreamTicketPurpose;
      readonly expires: number;
    }
  >();
  readonly #tickets = new Map<string, TicketGrant & { readonly expires: number }>();
  /** One-time launch tickets (D140 item 15), by the SHA-256 of their secret. */
  readonly #launches = new Map<string, { readonly tokenId: string; readonly expires: number }>();
  /** The frame tickets and the stream tickets each session holds, oldest first. */
  readonly #ticketsBySession = new Map<string, string[]>();
  readonly #streamTicketsBySession = new Map<string, string[]>();
  /** When the tickets were last swept. */
  #swept = Number.NEGATIVE_INFINITY;
  /** Failure times per artifact (`""` for tokens of no artifact in this home). */
  readonly #failures = new Map<string, number[]>();
  readonly #touched = new Map<string, number>();

  constructor(options: CapabilitiesOptions) {
    this.#ledger = options.ledger;
    this.#log = options.log;
    this.#key = options.key;
    this.#now = options.now;
    this.#shellOrigin = options.shellOrigin;
    this.#servesShell = options.servesShell ?? ((origin) => origin === this.#shellOrigin());
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
      readonly tokenId?: string;
      readonly viewerId?: string | undefined;
      readonly shellOrigin?: string | undefined;
    },
  ): MintedToken {
    const tokenId = input.tokenId ?? TokenId.create();
    const secret = this.secretOf(tokenId);
    const scopes = normalizeScopes(input.scopes);
    const shellOrigin = input.shellOrigin ?? this.#shellOrigin();
    db.run(
      "INSERT INTO token (id, secret_hash, artifact_id, scopes_json, viewer_id, expires_at, revoked_at, created_at, is_default, pinned_version, shell_origin) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)",
      tokenId,
      hashSecret(secret),
      input.artifactId,
      JSON.stringify(scopes),
      input.viewerId ?? null,
      input.expiresAt ?? null,
      this.#iso(this.#now()),
      input.isDefault ? 1 : 0,
      input.pinnedVersion ?? null,
      shellOrigin,
    );
    return {
      tokenId,
      secret,
      artifactId: input.artifactId,
      scopes,
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(input.pinnedVersion !== undefined ? { pinnedVersion: input.pinnedVersion } : {}),
      isDefault: input.isDefault,
      shellOrigin,
      ...(input.viewerId !== undefined ? { viewerId: input.viewerId } : {}),
    };
  }

  /** Mints a new token (`view/url`), in the caller's transaction when it passes one. */
  mint(
    input: {
      readonly artifactId: string;
      readonly scopes?: readonly CapabilityScope[] | undefined;
      readonly ttlMs?: number | undefined;
      readonly pinnedVersion?: number | undefined;
      /** The viewer the link acts for (D104). */
      readonly viewerId?: string | undefined;
      /** The shell address the link works at (D97 item 10); default: the loopback shell. */
      readonly shellOrigin?: string | undefined;
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
        viewerId: input.viewerId,
        shellOrigin: input.shellOrigin,
      }),
    );
  }

  /**
   * The artifact's default link (D97 item 3): the live default token, shown again from its
   * derived secret, or a new one. A default whose secret the current key no longer derives (the
   * key was replaced) stays valid for whoever holds it, and a new default takes its place; so does
   * one minted for another shell address, which works again if the gateway returns there.
   */
  defaultLink(artifactId: string, shellOrigin?: string): MintedToken {
    const origin = shellOrigin ?? this.#shellOrigin();
    return this.#ledger.write((db) => {
      const row = db.get<TokenRow>(
        "SELECT * FROM token WHERE artifact_id = ? AND is_default = 1",
        artifactId,
      );
      if (row) {
        const secret = this.secretOf(row.id);
        const here = row.shell_origin === origin;
        if (here && safeEqual(hashSecret(secret), row.secret_hash)) {
          return { ...grantOf(row), secret };
        }
        db.run("UPDATE token SET is_default = 0 WHERE id = ?", row.id);
        this.#log.warn("gateway.default_link_replaced", {
          artifactId,
          tokenId: row.id,
          reason: here ? "the capability key changed" : "the shell's address changed",
        });
      }
      return this.#insert(db, {
        artifactId,
        scopes: ALL_SCOPES,
        isDefault: true,
        shellOrigin: origin,
      });
    });
  }

  /** A token's grant, live or not; `undefined` when no such token exists. */
  grant(tokenId: string): (Grant & { readonly live: boolean }) | undefined {
    const row = this.#ledger.read((db) =>
      db.get<TokenRow>("SELECT * FROM token WHERE id = ?", tokenId),
    );
    return row ? { ...grantOf(row), live: this.#live(row) } : undefined;
  }

  /**
   * The token that stands for `tokenId` now: itself, or the token its rotations led to (D97 item
   * 6), so what holds a token ID (a share) follows its link through `view/rotate`.
   */
  current(tokenId: string): string {
    let id = tokenId;
    for (let hop = 0; hop < 1000; hop++) {
      const next = this.#ledger.read(
        (db) =>
          db.get<{ replaced_by: string | null }>("SELECT replaced_by FROM token WHERE id = ?", id)
            ?.replaced_by ?? null,
      );
      if (next === null) return id;
      id = next;
    }
    return id;
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
   * Replaces a live token with a new one of the same artifact, scopes, expiry, pinned version and viewer,
   * in one transaction (`view/rotate`, D97 item 6). Returns `undefined` for an unknown token and
   * `"dead"` for a revoked or expired one.
   */
  rotate(tokenId: string, within?: LedgerDb): MintedToken | "dead" | undefined {
    return this.#tx(within, (db) => {
      const row = db.get<TokenRow>("SELECT * FROM token WHERE id = ?", tokenId);
      if (!row) return undefined;
      if (!this.#live(row)) return "dead";
      const grant = grantOf(row);
      const replacement = TokenId.create();
      // The old token stops being the default first (one default per artifact), in the only update
      // a revocation makes: a revoked token never changes again (the ledger's trigger).
      db.run(
        "UPDATE token SET revoked_at = ?, is_default = 0, replaced_by = ? WHERE id = ?",
        this.#iso(this.#now()),
        replacement,
        tokenId,
      );
      const minted = this.#insert(db, {
        tokenId: replacement,
        artifactId: grant.artifactId,
        scopes: grant.scopes,
        expiresAt: grant.expiresAt,
        pinnedVersion: grant.pinnedVersion,
        isDefault: grant.isDefault,
        viewerId: grant.viewerId,
        // A link stays at the address its holder uses: a share's, a host's external base, served
        // now or not (a share's faces are down while it is set up again after a restart, Opus
        // review of WP-13). Only a loopback link whose shell moved to another port moves to the
        // shell's address now (D97 item 10, GPT review of WP-13).
        shellOrigin:
          sameHost(grant.shellOrigin, this.#shellOrigin()) && !this.#servesShell(grant.shellOrigin)
            ? undefined
            : grant.shellOrigin,
      });
      appendEvent(db, {
        artifactId: grant.artifactId,
        type: "token.revoked",
        payload: { tokenId, reason: "rotated", replacedBy: minted.tokenId },
      });
      return minted;
    });
  }

  /**
   * A refusal, with its `Retry-After` seconds, while too many tokens for `artifactId` failed in the
   * last minute (D97 item 8). One artifact's limit never holds another's links back.
   */
  limited(artifactId: string): (Refusal & { readonly retryAfter: number }) | undefined {
    const now = this.#now();
    const failures = this.#failures.get(artifactId);
    if (!failures) return undefined;
    while (failures.length > 0 && (failures[0] ?? 0) <= now - FAILURE_WINDOW_MS) failures.shift();
    if (failures.length === 0) {
      this.#failures.delete(artifactId);
      return undefined;
    }
    if (failures.length < FAILURE_LIMIT) return undefined;
    const retry = Math.max(1, Math.ceil(((failures[0] ?? now) + FAILURE_WINDOW_MS - now) / 1000));
    return {
      ...refusal("MOSTRA_HYGIENE_RATE_LIMITED", `Too many failed attempts; retry in ${retry} s.`),
      retryAfter: retry,
    };
  }

  /** Counts a failed token for `artifactId`; a token for no artifact of this home counts once, under `""`. */
  #fail(artifactId: string): void {
    const known =
      artifactId !== "" &&
      this.#ledger.read((db) => db.get("SELECT 1 FROM artifact WHERE id = ?", artifactId)) !==
        undefined;
    const key = known ? artifactId : "";
    const now = this.#now();
    const failures = (this.#failures.get(key) ?? []).filter((at) => at > now - FAILURE_WINDOW_MS);
    failures.push(now);
    this.#failures.set(key, failures);
  }

  /**
   * Checks a capability token presented for `artifactId`. While the artifact's guessing limit
   * holds, every token is refused, a right one too, and the limit is checked here, at the moment
   * of the check, so concurrent guesses can't slip past it. An unknown secret, or one for another
   * artifact, is `MOSTRA_HYGIENE_TOKEN_INVALID`; a revoked or expired one, or one minted for
   * another shell address, `_TOKEN_REVOKED`. Unknown secrets count towards the limit.
   */
  presentToken(
    secret: unknown,
    artifactId: string,
    shellOrigin?: string,
  ): Grant | (Refusal & { readonly retryAfter?: number }) {
    const limited = this.limited(artifactId);
    if (limited) return limited;
    if (!looksLikeSecret(secret)) {
      this.#fail(artifactId);
      return refusal(
        "MOSTRA_HYGIENE_TOKEN_INVALID",
        "The capability token isn't one Mostra minted.",
      );
    }
    const row = this.#ledger.read((db) =>
      db.get<TokenRow>("SELECT * FROM token WHERE secret_hash = ?", hashSecret(secret)),
    );
    if (!row || row.artifact_id !== artifactId) {
      this.#fail(artifactId);
      return refusal(
        "MOSTRA_HYGIENE_TOKEN_INVALID",
        "No capability token in this home matches this link.",
      );
    }
    if (!this.#live(row)) {
      return refusal(
        "MOSTRA_HYGIENE_TOKEN_REVOKED",
        row.revoked_at !== null ? "This link was revoked." : "This link has expired.",
      );
    }
    if (row.shell_origin !== (shellOrigin ?? this.#shellOrigin())) {
      return refusal(
        "MOSTRA_HYGIENE_TOKEN_REVOKED",
        `This link was made for ${row.shell_origin}, not this address.`,
      );
    }
    return grantOf(row);
  }

  /** Starts a session for a grant on one origin; returns the cookie secret and CSRF token. */
  createSession(input: {
    readonly tokenId: string;
    readonly origin: string;
    readonly versionId?: string;
    /** The person the host's identity port named, for a link without a viewer (D143 item 2). */
    readonly viewerId?: string | undefined;
    /** `worker` for a worker-mode frame (D70), whose secret travels in a header; default `cookie`. */
    readonly mode?: "cookie" | "worker";
  }): {
    readonly cookie: string;
    readonly csrf: string;
    readonly id: string;
  } {
    const cookie = randomSecret();
    const csrf = csrfOf(cookie);
    const id = hashSecret(cookie);
    const now = this.#iso(this.#now());
    this.#ledger.write((db) =>
      db.run(
        "INSERT INTO session (id, token_id, origin, mode, csrf, version_id, created_at, last_seen_at, viewer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        id,
        input.tokenId,
        input.origin,
        input.mode ?? "cookie",
        hashSecret(csrf),
        input.versionId ?? null,
        now,
        now,
        input.viewerId ?? null,
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
    mode: "cookie" | "worker" = "cookie",
  ): ResolvedSession | Refusal {
    let revoked = false;
    for (const value of cookies) {
      if (!looksLikeSecret(value)) continue;
      const found = this.#ledger.read((db) => {
        const session = db.get<SessionRow>("SELECT * FROM session WHERE id = ?", hashSecret(value));
        // A session works only the way it was made: a cookie never stands for a frame header.
        if (!session || session.origin !== origin || session.mode !== mode) return undefined;
        const token = db.get<TokenRow>("SELECT * FROM token WHERE id = ?", session.token_id);
        return token && token.artifact_id === artifactId ? { session, token } : undefined;
      });
      if (!found) continue;
      if (!this.#live(found.token)) {
        revoked = true;
        continue;
      }
      const csrf = csrfOf(value);
      // A row whose CSRF hash doesn't match was not made by this code: it doesn't count.
      if (!safeEqual(hashSecret(csrf), found.session.csrf)) continue;
      this.#touch(found.session.id);
      const grant = grantOf(found.token);
      // A link's own viewer always wins: a token's viewer never changes (D104).
      const viewerId = grant.viewerId ?? found.session.viewer_id ?? undefined;
      return {
        id: found.session.id,
        csrf,
        mode,
        ...(found.session.version_id !== null ? { versionId: found.session.version_id } : {}),
        grant,
        ...(viewerId !== undefined ? { viewerId } : {}),
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

  /** Mints a single-use frame ticket (D98 item 3); a shell session holds at most a few at once. */
  mintTicket(grant: Omit<TicketGrant, never>): string {
    const ticket = randomSecret();
    this.#sweepTickets();
    const key = hashSecret(ticket);
    this.#tickets.set(key, { ...grant, expires: this.#now() + TICKET_TTL_MS });
    this.#hold(this.#ticketsBySession, this.#tickets, grant.shellSessionId, key);
    return ticket;
  }

  /**
   * Records a session's new ticket and drops its oldest beyond {@link TICKETS_PER_SESSION}, so no
   * link holder can make the maps grow without bound by asking for tickets in a loop (Opus review
   * of WP-13). A page uses one or two at a time.
   */
  #hold(
    bySession: Map<string, string[]>,
    tickets: Map<string, unknown>,
    sessionId: string,
    key: string,
  ): void {
    const held = (bySession.get(sessionId) ?? []).filter((one) => tickets.has(one));
    held.push(key);
    while (held.length > TICKETS_PER_SESSION) tickets.delete(held.shift() as string);
    bySession.set(sessionId, held);
  }

  /**
   * Redeems a ticket on `origin`, once, while the shell session that asked for it lives and its
   * link is live (D98 item 3).
   */
  redeemTicket(ticket: unknown, origin: string): TicketGrant | Refusal {
    this.#sweepTickets();
    const key = looksLikeSecret(ticket) ? hashSecret(ticket) : undefined;
    const entry = key === undefined ? undefined : this.#tickets.get(key);
    if (key !== undefined) this.#tickets.delete(key);
    if (!entry || entry.expires <= this.#now() || entry.origin !== origin) {
      return refusal(
        "MOSTRA_HYGIENE_TOKEN_INVALID",
        "The frame ticket is unknown, used or expired.",
      );
    }
    const shellSession = this.#ledger.read((db) =>
      db.get<{ token_id: string }>(
        "SELECT token_id FROM session WHERE id = ?",
        entry.shellSessionId,
      ),
    );
    if (shellSession?.token_id !== entry.tokenId) {
      return refusal(
        "MOSTRA_HYGIENE_SESSION_MISSING",
        "The shell session that asked for this frame ticket has ended.",
      );
    }
    const grant = this.grant(entry.tokenId);
    if (!grant?.live) {
      return refusal(
        "MOSTRA_HYGIENE_TOKEN_REVOKED",
        "The link behind this frame was revoked or has expired.",
      );
    }
    const { expires: _expires, ...rest } = entry;
    return rest;
  }

  /**
   * Mints a single-use ticket that opens one event stream, long poll or WebSocket of a session
   * without the session's credential (D158 item 5): a worker-mode page's streams bypass its
   * service worker, which can't carry them. It lives 60 s in memory and is never recorded.
   */
  mintStreamTicket(input: {
    readonly sessionId: string;
    readonly origin: string;
    readonly artifactId: string;
    readonly purpose: StreamTicketPurpose;
  }): { readonly ticket: string; readonly expiresAt: string } {
    this.#sweepTickets();
    const ticket = randomSecret();
    const expires = this.#now() + TICKET_TTL_MS;
    const key = hashSecret(ticket);
    this.#streamTickets.set(key, { ...input, expires });
    this.#hold(this.#streamTicketsBySession, this.#streamTickets, input.sessionId, key);
    return { ticket, expiresAt: this.#iso(expires) };
  }

  /**
   * Spends a stream ticket on `origin` for `artifactId` and `purpose`, and resolves its session
   * as a request carrying the session's credential would, its link's liveness included. The
   * session's CSRF token isn't known here: a ticket opens reads only (streams, polls, sockets).
   */
  redeemStreamTicket(
    ticket: unknown,
    origin: string,
    artifactId: string,
    purpose: StreamTicketPurpose,
  ): ResolvedSession | Refusal {
    this.#sweepTickets();
    const key = looksLikeSecret(ticket) ? hashSecret(ticket) : undefined;
    const entry = key === undefined ? undefined : this.#streamTickets.get(key);
    if (key !== undefined) this.#streamTickets.delete(key);
    if (
      !entry ||
      entry.expires <= this.#now() ||
      entry.origin !== origin ||
      entry.artifactId !== artifactId ||
      entry.purpose !== purpose
    ) {
      return refusal(
        "MOSTRA_HYGIENE_TOKEN_INVALID",
        "The stream ticket is unknown, used or expired.",
      );
    }
    const found = this.#ledger.read((db) => {
      const session = db.get<SessionRow>("SELECT * FROM session WHERE id = ?", entry.sessionId);
      if (!session || session.origin !== origin) return undefined;
      const token = db.get<TokenRow>("SELECT * FROM token WHERE id = ?", session.token_id);
      return token && token.artifact_id === artifactId ? { session, token } : undefined;
    });
    if (!found) {
      return refusal("MOSTRA_HYGIENE_SESSION_MISSING", "The session behind this ticket has ended.");
    }
    if (!this.#live(found.token)) {
      return refusal(
        "MOSTRA_HYGIENE_TOKEN_REVOKED",
        "The link this session came from was revoked or has expired.",
      );
    }
    const grant = grantOf(found.token);
    const viewerId = grant.viewerId ?? found.session.viewer_id ?? undefined;
    return {
      id: found.session.id,
      csrf: "",
      mode: found.session.mode,
      ...(found.session.version_id !== null ? { versionId: found.session.version_id } : {}),
      grant,
      ...(viewerId !== undefined ? { viewerId } : {}),
    };
  }

  /**
   * Drops expired tickets, at most once a second: every use checks a ticket's expiry itself, so a
   * sweep only frees memory, and a burst of requests never makes each one walk every ticket (Opus
   * review of WP-13).
   */
  #sweepTickets(): void {
    const now = this.#now();
    if (now - this.#swept < SWEEP_INTERVAL_MS && now >= this.#swept) return;
    this.#swept = now;
    for (const [sessionId, held] of this.#ticketsBySession) {
      if (!held.some((key) => this.#tickets.has(key))) this.#ticketsBySession.delete(sessionId);
    }
    for (const [sessionId, held] of this.#streamTicketsBySession) {
      if (!held.some((key) => this.#streamTickets.has(key))) {
        this.#streamTicketsBySession.delete(sessionId);
      }
    }
    for (const [key, entry] of this.#tickets) if (entry.expires <= now) this.#tickets.delete(key);
    for (const [key, entry] of this.#streamTickets) {
      if (entry.expires <= now) this.#streamTickets.delete(key);
    }
    for (const [key, entry] of this.#launches) if (entry.expires <= now) this.#launches.delete(key);
  }

  /**
   * Mints a one-time launch ticket for a live link (D140 item 15): a browser opened from a command
   * line gets it instead of the link's secret, which other local users could read there. It lives
   * 60 s in memory and is never recorded. `undefined` for an unknown token, `"dead"` for a
   * revoked or expired one, or one minted for another shell address.
   */
  mintLaunch(
    tokenId: string,
  ):
    | { readonly ticket: string; readonly grant: Grant; readonly expiresAt: string }
    | "dead"
    | undefined {
    const grant = this.grant(tokenId);
    if (!grant) return undefined;
    if (!grant.live || !this.#servesShell(grant.shellOrigin)) return "dead";
    this.#sweepTickets();
    const ticket = randomSecret();
    const expires = this.#now() + TICKET_TTL_MS;
    this.#launches.set(hashSecret(ticket), { tokenId, expires });
    const { live: _live, ...rest } = grant;
    return { ticket, grant: rest, expiresAt: this.#iso(expires) };
  }

  /**
   * Checks a launch ticket presented for `artifactId` like a token (the guessing limit applies,
   * and unknown tickets count), and spends it when `spend` is set. The exchange spends it only
   * once a session exists, so a viewer who chooses between two links (D98 item 8) can still use it
   * within its minute.
   */
  presentLaunch(
    ticket: unknown,
    artifactId: string,
    spend: boolean,
    shellOrigin?: string,
  ): Grant | (Refusal & { readonly retryAfter?: number }) {
    const limited = this.limited(artifactId);
    if (limited) return limited;
    this.#sweepTickets();
    const key = looksLikeSecret(ticket) ? hashSecret(ticket) : undefined;
    const found = key === undefined ? undefined : this.#launches.get(key);
    const entry = found && found.expires > this.#now() ? found : undefined;
    const grant = entry ? this.grant(entry.tokenId) : undefined;
    if (!entry || !grant || grant.artifactId !== artifactId) {
      this.#fail(artifactId);
      return refusal(
        "MOSTRA_HYGIENE_TOKEN_INVALID",
        "The launch ticket is unknown, used or expired.",
      );
    }
    if (!grant.live || grant.shellOrigin !== (shellOrigin ?? this.#shellOrigin())) {
      return refusal(
        "MOSTRA_HYGIENE_TOKEN_REVOKED",
        "The link behind this launch ticket was revoked, has expired, or is for another address.",
      );
    }
    if (spend && key !== undefined) this.#launches.delete(key);
    const { live: _live, ...rest } = grant;
    return rest;
  }

  /**
   * Spends a launch ticket that started a session: `true` only for the caller that spent it, so
   * two exchanges that both presented it while a host's identity port was answering get one
   * session between them (GPT review of WP-12, finding 1).
   */
  spendLaunch(ticket: unknown): boolean {
    // An expired ticket can't be spent (Opus review of WP-12, finding 3).
    this.#sweepTickets();
    if (!looksLikeSecret(ticket)) return false;
    const key = hashSecret(ticket);
    const entry = this.#launches.get(key);
    if (!entry || entry.expires <= this.#now()) return false;
    return this.#launches.delete(key);
  }

  /** Removes sessions unseen for longer than their cookie lives; no browser holds them any more. */
  prune(): number {
    const cutoff = this.#iso(this.#now() - SESSION_MAX_AGE_S * 1000);
    return this.#ledger.write(
      (db) => db.run("DELETE FROM session WHERE last_seen_at < ?", cutoff).changes,
    );
  }
}
