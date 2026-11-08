/**
 * The authorization server's clients (INTERFACES §18.5; VERIFIED_FACTS, WP-30): first-party ones
 * (the CLI, and one hosted shell per user-content domain), clients that registered through Dynamic
 * Client Registration (RFC 7591, deprecated by the MCP specification and still Claude's fallback),
 * and clients named by a Client ID Metadata Document: an `https` URL with a path whose document the
 * server fetches.
 *
 * A metadata document is fetched over `https` only, from a public address only: the name is
 * resolved once, every address it gives must be public (no loopback, private, link-local,
 * unique-local, carrier-grade NAT, multicast, reserved or cloud metadata address), and the request
 * goes to the address that was checked, so a second resolution can't move it (DNS rebinding). No
 * redirect is followed; at most 64 KiB, within 5 s; the document's `client_id` must equal its URL;
 * it is cached as its `Cache-Control` allows (at least a minute, at most a day).
 *
 * A redirect URI matches exactly, except that the port is ignored for `http://127.0.0.1`,
 * `http://[::1]` and `http://localhost` (RFC 8252 §7.3; Claude Code's loopback callback).
 */
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import type { Ledger } from "../ledger/index.ts";
import type { Environment, Log } from "../log.ts";

/** The largest metadata document read. */
const MAX_DOCUMENT_BYTES = 64 * 1024;
/** How long fetching one may take. */
const FETCH_TIMEOUT_MS = 5_000;
/** Registered clients unused this long are removed (INTERFACES §18.5). */
const UNUSED_CLIENT_MS = 30 * 24 * 60 * 60 * 1000;

/** What the server knows of a client. */
export interface OAuthClient {
  readonly id: string;
  readonly kind: "metadata" | "registered" | "shell" | "cli";
  readonly name: string;
  readonly redirectUris: readonly string[];
  /** Whether the name was stated by the client itself, never checked (all but first-party). */
  readonly unverified: boolean;
}

/** A refusal of a client, as an OAuth error. */
export interface ClientRefusal {
  readonly error:
    | "invalid_client"
    | "invalid_request"
    | "invalid_redirect_uri"
    | "invalid_client_metadata";
  readonly description: string;
}

/** Whether an IP address is one no client document may come from. */
export function forbiddenAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return forbiddenAddress(mapped[1] as string);
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("ff") ||
      lower.startsWith("64:ff9b:") ||
      lower.startsWith("2001:db8:")
    );
  }
  return true;
}

/** Whether a redirect URI a request names is one the client's list allows. */
export function redirectAllowed(registered: readonly string[], asked: string): boolean {
  if (registered.includes(asked)) return true;
  let url: URL;
  try {
    url = new URL(asked);
  } catch {
    return false;
  }
  const loopback =
    url.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "localhost");
  if (!loopback) return false;
  return registered.some((entry) => {
    try {
      const known = new URL(entry);
      return (
        known.protocol === "http:" &&
        known.hostname === url.hostname &&
        known.pathname === url.pathname &&
        known.search === url.search
      );
    } catch {
      return false;
    }
  });
}

/** Whether a redirect URI may be registered at all: https, or http on a loopback name. */
function redirectRegistrable(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.hash !== "") return false;
    if (url.protocol === "https:") return true;
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

/** Options for {@link createClients}. */
export interface ClientsOptions {
  readonly directory: Ledger;
  readonly log: Log;
  readonly env: Environment;
  readonly now?: () => number;
  /**
   * Whether an origin is a hosted shell's (a domain's apex, or a host an operator supplies): each
   * is a first-party public client, `<origin>/_mostra/signin`.
   */
  readonly isShellOrigin: (origin: string) => boolean;
}

/** The authorization server's clients. */
export interface Clients {
  /** A client by its ID: first-party, registered, or fetched from its metadata document. */
  find(clientId: string): Promise<OAuthClient | ClientRefusal>;
  /** Dynamic Client Registration (RFC 7591): the client's answer, or a refusal. */
  register(metadata: unknown): Record<string, unknown> | ClientRefusal;
  /** Notes a client was used, so an unused registration can be removed after 30 days. */
  used(clientId: string): void;
  /** The client ID of a domain's hosted shell. */
  shellClientId(shellOrigin: string): string;
}

/** Whether a client ID names a metadata document: an https URL with a path. */
export function metadataClientId(clientId: string): URL | undefined {
  try {
    const url = new URL(clientId);
    return url.protocol === "https:" && url.pathname.length > 1 && url.hash === ""
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

/** Builds the clients over the directory. */
export function createClients(options: ClientsOptions): Clients {
  const { directory, log } = options;
  const now = options.now ?? (() => Date.now());
  const fetched = new Map<string, { client: OAuthClient; until: number }>();
  // Tests serve a metadata document from loopback over http; only that exact origin, by name.
  const testOrigin = options.env["MOSTRA_TEST_CIMD_ORIGIN"];

  const sweep = (): void => {
    directory.write((db) =>
      db.run(
        "DELETE FROM oauth_client WHERE kind = 'registered' AND COALESCE(last_used_at, created_at) < ? AND id NOT IN (SELECT client_id FROM \"grant\" WHERE revoked_at IS NULL)",
        new Date(now() - UNUSED_CLIENT_MS).toISOString(),
      ),
    );
  };

  /** Fetches a document from a checked public address, with no redirect, bounded. */
  const fetchDocument = (url: URL): Promise<{ status: number; body: string; maxAge: number }> =>
    new Promise((resolve, reject) => {
      const test =
        testOrigin !== undefined && url.origin === testOrigin.replace(/^http:/, "https:");
      const pinned: LookupFunction = (hostname, _options, callback) => {
        lookup(hostname, { all: true, verbatim: true })
          .then((addresses) => {
            if (addresses.length === 0) throw new Error("no address");
            for (const found of addresses) {
              if (forbiddenAddress(found.address)) {
                throw new Error(`the name resolves to a non-public address (${found.address})`);
              }
            }
            const chosen = addresses[0] as { address: string; family: number };
            callback(null, chosen.address, chosen.family);
          })
          .catch((error: Error) => callback(error, "", 0));
      };
      const literal = isIP(url.hostname.replace(/^\[|\]$/g, ""));
      if (!test && literal !== 0 && forbiddenAddress(url.hostname.replace(/^\[|\]$/g, ""))) {
        reject(new Error("the document's address isn't public"));
        return;
      }
      const target = test ? new URL(url.href.replace(/^https:/, "http:")) : url;
      const request = (test ? httpRequest : httpsRequest)(
        target,
        {
          method: "GET",
          headers: { accept: "application/json", "user-agent": "mostra-remote-server" },
          timeout: FETCH_TIMEOUT_MS,
          ...(test ? {} : { lookup: pinned }),
        },
        (response) => {
          let size = 0;
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_DOCUMENT_BYTES) {
              request.destroy(new Error("the document is larger than 64 KiB"));
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            const cache = String(response.headers["cache-control"] ?? "");
            const age = /max-age=(\d+)/.exec(cache);
            const noStore = /no-store|no-cache/.test(cache);
            resolve({
              status: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
              maxAge: noStore ? 60 : Math.min(86_400, Math.max(60, age ? Number(age[1]) : 300)),
            });
          });
          response.on("error", reject);
        },
      );
      const deadline = setTimeout(
        () => request.destroy(new Error("the document took longer than 5 s")),
        FETCH_TIMEOUT_MS,
      );
      request.on("close", () => clearTimeout(deadline));
      request.on("timeout", () => request.destroy(new Error("the document took longer than 5 s")));
      request.on("error", reject);
      request.end();
    });

  const fromDocument = async (url: URL): Promise<OAuthClient | ClientRefusal> => {
    const cached = fetched.get(url.href);
    if (cached && cached.until > now()) return cached.client;
    let answer: { status: number; body: string; maxAge: number };
    try {
      answer = await fetchDocument(url);
    } catch (error) {
      log.warn("oauth.cimd_refused", { client: url.href, reason: (error as Error).message });
      return {
        error: "invalid_client",
        description: `The client's metadata document can't be fetched: ${(error as Error).message}.`,
      };
    }
    if (answer.status !== 200) {
      // A redirect is never followed: the document must be served at its own URL.
      return {
        error: "invalid_client",
        description: `The client's metadata document answered ${answer.status}, not 200.`,
      };
    }
    let document: {
      client_id?: unknown;
      client_name?: unknown;
      redirect_uris?: unknown;
    };
    try {
      document = JSON.parse(answer.body) as typeof document;
    } catch {
      return { error: "invalid_client", description: "The client's metadata document isn't JSON." };
    }
    if (document.client_id !== url.href) {
      return {
        error: "invalid_client",
        description: "The metadata document's client_id isn't its own URL.",
      };
    }
    const redirects = Array.isArray(document.redirect_uris)
      ? document.redirect_uris.filter(
          (uri): uri is string => typeof uri === "string" && redirectRegistrable(uri),
        )
      : [];
    if (redirects.length === 0) {
      return {
        error: "invalid_client",
        description: "The metadata document names no usable redirect_uris.",
      };
    }
    const client: OAuthClient = {
      id: url.href,
      kind: "metadata",
      name:
        typeof document.client_name === "string" && document.client_name.trim() !== ""
          ? document.client_name.trim().slice(0, 128)
          : url.hostname,
      redirectUris: redirects,
      unverified: true,
    };
    fetched.set(url.href, { client, until: now() + answer.maxAge * 1000 });
    if (fetched.size > 1_000) fetched.delete(fetched.keys().next().value as string);
    directory.write((db) =>
      db.run(
        `INSERT INTO oauth_client (id, kind, metadata_json, created_at) VALUES (?, 'metadata', ?, ?)
           ON CONFLICT (id) DO UPDATE SET metadata_json = excluded.metadata_json`,
        client.id,
        JSON.stringify({ client_name: client.name, redirect_uris: client.redirectUris }),
        new Date(now()).toISOString(),
      ),
    );
    return client;
  };

  const shellClientId = (shellOrigin: string): string => `${shellOrigin}/_mostra/signin`;

  return {
    shellClientId,

    async find(clientId) {
      if (clientId === "mostra-cli") {
        return {
          id: clientId,
          kind: "cli",
          name: "Mostra CLI",
          redirectUris: [],
          unverified: false,
        };
      }
      const suffix = "/_mostra/signin";
      const origin = clientId.endsWith(suffix) ? clientId.slice(0, -suffix.length) : undefined;
      if (origin !== undefined && options.isShellOrigin(origin)) {
        directory.write((db) =>
          db.run(
            "INSERT OR IGNORE INTO oauth_client (id, kind, metadata_json, created_at) VALUES (?, 'shell', ?, ?)",
            clientId,
            JSON.stringify({ client_name: "Mostra" }),
            new Date(now()).toISOString(),
          ),
        );
        return {
          id: clientId,
          kind: "shell",
          name: "Mostra",
          redirectUris: [`${origin}/_mostra/signin`],
          unverified: false,
        };
      }
      const url = metadataClientId(clientId);
      if (url) return fromDocument(url);
      const row = directory.read((db) =>
        db.get<{ metadata_json: string }>(
          "SELECT metadata_json FROM oauth_client WHERE id = ? AND kind = 'registered'",
          clientId,
        ),
      );
      if (!row) return { error: "invalid_client", description: "Unknown client." };
      const metadata = JSON.parse(row.metadata_json) as {
        client_name?: string;
        redirect_uris: string[];
      };
      return {
        id: clientId,
        kind: "registered",
        name: metadata.client_name ?? "An unnamed client",
        redirectUris: metadata.redirect_uris,
        unverified: true,
      };
    },

    register(metadata) {
      sweep();
      const body = (typeof metadata === "object" && metadata !== null ? metadata : {}) as {
        redirect_uris?: unknown;
        client_name?: unknown;
        token_endpoint_auth_method?: unknown;
        grant_types?: unknown;
      };
      const redirects = Array.isArray(body.redirect_uris)
        ? body.redirect_uris.filter((uri): uri is string => typeof uri === "string")
        : [];
      if (
        redirects.length === 0 ||
        redirects.length > 10 ||
        !redirects.every(redirectRegistrable)
      ) {
        return {
          error: "invalid_redirect_uri",
          description:
            "redirect_uris must list https: addresses, or http: on 127.0.0.1, [::1] or localhost.",
        };
      }
      if (
        body.token_endpoint_auth_method !== undefined &&
        body.token_endpoint_auth_method !== "none"
      ) {
        return {
          error: "invalid_client_metadata",
          description:
            "This server registers public clients only (token_endpoint_auth_method none).",
        };
      }
      const name =
        typeof body.client_name === "string" ? body.client_name.trim().slice(0, 128) : undefined;
      const id = `mcl_${randomBytes(16).toString("hex")}`;
      const at = new Date(now());
      directory.write((db) =>
        db.run(
          "INSERT INTO oauth_client (id, kind, metadata_json, created_at, last_used_at) VALUES (?, 'registered', ?, ?, ?)",
          id,
          JSON.stringify({ client_name: name, redirect_uris: redirects }),
          at.toISOString(),
          at.toISOString(),
        ),
      );
      log.info("oauth.client_registered", { client: id });
      return {
        client_id: id,
        client_id_issued_at: Math.floor(at.getTime() / 1000),
        ...(name !== undefined ? { client_name: name } : {}),
        redirect_uris: redirects,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      };
    },

    used(clientId) {
      directory.write((db) =>
        db.run(
          "UPDATE oauth_client SET last_used_at = ? WHERE id = ?",
          new Date(now()).toISOString(),
          clientId,
        ),
      );
    },
  };
}
