/**
 * The remote server's API origin (INTERFACES §18.2, §18.5): the authorization server's device
 * grant (`/oauth/device`, `/oauth/token`, `/oauth/revoke`, its metadata and the device page), the
 * network binding (`/host`, JSON-RPC over WebSocket with a bearer token) and version files
 * (`PUT /files/<sha256>`). Never on a user-content domain (D165 item 7).
 */
import { createHash, randomBytes } from "node:crypto";
import { createWriteStream, existsSync, renameSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { type WebSocket, WebSocketServer } from "ws";
import type { Log } from "../log.ts";
import { BINDING_SUBPROTOCOL, MAX_FRAME_BYTES, serveWebSocket } from "../protocol-server/index.ts";
import type { Authenticated, Authorization } from "./auth.ts";
import type { RemoteServerConfig } from "./config.ts";
import type { HostedHome } from "./hosted.ts";

/** How often an open binding's grant is checked again: a revocation closes it within 60 s. */
const GRANT_RECHECK_MS = 30_000;

/** The largest version file accepted (per file; an operator's storage limit is WP-30's). */
const MAX_FILE_BYTES = 256 * 1024 * 1024;

const BASE_HEADERS = {
  "cache-control": "no-store",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

function send(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    ...BASE_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(text)),
    ...headers,
  });
  response.end(text);
}

function page(response: ServerResponse, status: number, html: string): void {
  response.writeHead(status, {
    ...BASE_HEADERS,
    "content-type": "text/html; charset=utf-8",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    "x-frame-options": "DENY",
    // The device page posts its own form, whose `Origin` the server checks: under `no-referrer`
    // browsers send `Origin: null` for a form's POST, so this page sends origins to itself only.
    "referrer-policy": "same-origin",
  });
  response.end(html);
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > limit) return undefined;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** Options for {@link createApi}. */
export interface ApiOptions {
  readonly config: RemoteServerConfig;
  readonly auth: Authorization;
  readonly log: Log;
  readonly filesDir: string;
  /** The hosted home an account's token names, opened on demand. */
  readonly home: (homeId: string) => Promise<HostedHome>;
  /** Notes a home was used, so it isn't closed while used. */
  readonly touch: (homeId: string) => void;
  /** Told each message a home's binding carried in (relay and sync traffic), for metering. */
  readonly message?: (homeId: string) => void;
  /** Told the bytes a home stored (an upload it hadn't stored before), for metering. */
  readonly stored?: (homeId: string, bytes: number) => void;
  /** Whether the operator suspended a home: its bindings and uploads are refused (D165 item 9). */
  readonly suspended?: (homeId: string) => boolean;
  /** How often an open binding's token and grant are checked; tests shorten it. */
  readonly recheckMs?: number;
}

/** The API origin's request and upgrade handlers. */
export interface Api {
  request(request: IncomingMessage, response: ServerResponse, path: string): Promise<void>;
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer, path: string): void;
  /** Closes every binding of a home now (a suspension or a move, 4403). */
  closeHome(homeId: string): void;
  close(): void;
}

/** The development identity provider, when the configuration names one (§18.5, WP-29). */
function developmentProvider(
  config: RemoteServerConfig,
): { id: string; label: string } | undefined {
  const provider = config.identityProviders?.find((candidate) => candidate.kind === "development");
  return provider ? { id: provider.id, label: provider.label ?? "Development sign-in" } : undefined;
}

/** The device page: the code, the warning, and the development provider's sign-in. */
function devicePage(options: {
  readonly code: string;
  readonly provider: { id: string; label: string } | undefined;
  readonly message?: string;
  readonly done?: boolean;
}): string {
  const body = options.done
    ? `<p>${escapeHtml(options.message ?? "Done.")}</p><p>You can close this page.</p>`
    : `${options.message ? `<p role="alert">${escapeHtml(options.message)}</p>` : ""}
<p><strong>Approving links a machine to your account.</strong> That machine's Mostra can then host
pages under your account and receives their answers. Continue only if you started this sign-in
yourself, on that machine.</p>
${
  options.provider
    ? `<form method="post" action="/device">
<label>Code <input name="user_code" value="${escapeHtml(options.code)}" autocomplete="off" required></label>
<p>${escapeHtml(options.provider.label)}: this server signs people in with a development provider,
which trusts the name you type. Use it only on a server you run for yourself or for tests.</p>
<label>Your name <input name="name" required maxlength="64"></label>
<input type="hidden" name="provider" value="${escapeHtml(options.provider.id)}">
<p><button name="decision" value="approve">Approve this machine</button>
<button name="decision" value="deny">Refuse</button></p>
</form>`
    : "<p>This server has no identity provider configured, so nobody can sign in yet.</p>"
}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Link a machine to Mostra</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem}
input{font:inherit;padding:.3rem}button{font:inherit;padding:.4rem .9rem;margin-right:.5rem}</style></head>
<body><h1>Link a machine to Mostra</h1>${body}</body></html>`;
}

/** Creates the API origin. */
export function createApi(options: ApiOptions): Api {
  const { config, auth, log } = options;
  const apiOrigin = config.apiOrigin;
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FRAME_BYTES,
    perMessageDeflate: false,
    handleProtocols: (protocols) =>
      protocols.has(BINDING_SUBPROTOCOL) ? BINDING_SUBPROTOCOL : false,
  });
  const bindings = new Set<WebSocket>();
  const bindingHomes = new Map<WebSocket, string>();

  const bearer = (request: IncomingMessage): Authenticated | undefined => {
    const header = request.headers.authorization ?? "";
    const match = /^bearer\s+(\S+)$/i.exec(header);
    return match ? auth.authenticate(match[1] as string) : undefined;
  };

  const unauthorized = (response: ServerResponse, message: string): void =>
    send(
      response,
      401,
      { code: "MOSTRA_REMOTE_LOGIN_FAILED", message },
      {
        "www-authenticate": `Bearer resource_metadata="${apiOrigin}/.well-known/oauth-protected-resource/host"`,
      },
    );

  const metadata = () => ({
    issuer: apiOrigin,
    token_endpoint: `${apiOrigin}/oauth/token`,
    device_authorization_endpoint: `${apiOrigin}/oauth/device`,
    revocation_endpoint: `${apiOrigin}/oauth/revoke`,
    grant_types_supported: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["mostra", "offline_access"],
    authorization_response_iss_parameter_supported: true,
  });

  const form = async (request: IncomingMessage): Promise<URLSearchParams | undefined> => {
    const type = request.headers["content-type"] ?? "";
    if (!type.startsWith("application/x-www-form-urlencoded")) return undefined;
    const body = await readBody(request, 64 * 1024);
    return body === undefined ? undefined : new URLSearchParams(body.toString("utf8"));
  };

  const upload = async (
    request: IncomingMessage,
    response: ServerResponse,
    sha: string,
  ): Promise<void> => {
    const who = bearer(request);
    if (!who) {
      unauthorized(response, "Version files need the binding's access token.");
      return;
    }
    const home = await options.home(who.homeId);
    options.touch(who.homeId);
    if (options.suspended?.(who.homeId)) {
      send(response, 403, {
        code: "MOSTRA_REMOTE_HOME_SUSPENDED",
        message: "This account's pages are suspended by the server's operator.",
      });
      return;
    }
    // A file is accepted only for a pending push of this home that names it as missing, so no
    // home stores bytes nobody asked for, nor learns what another home holds (§18.2).
    if (!home.wanted(sha)) {
      send(response, 409, {
        code: "MOSTRA_HOME_INTEGRITY",
        message: "No pending push of this home names that file as missing.",
      });
      return;
    }
    const target = join(options.filesDir, sha);
    const scratch = join(options.filesDir, `.upload-${randomBytes(8).toString("hex")}`);
    const hash = createHash("sha256");
    let size = 0;
    let tooLarge = false;
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(scratch, { mode: 0o600 });
      request.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_FILE_BYTES) {
          tooLarge = true;
          request.destroy();
          return;
        }
        hash.update(chunk);
        out.write(chunk);
      });
      request.on("end", () => out.end(() => resolve()));
      request.on("error", reject);
      request.on("close", () => {
        if (tooLarge) out.end(() => resolve());
      });
    }).catch(() => undefined);
    if (tooLarge || hash.digest("hex") !== sha) {
      await rm(scratch, { force: true });
      send(response, tooLarge ? 413 : 400, {
        code: "MOSTRA_HOME_INTEGRITY",
        message: tooLarge ? "The file is too large." : "The bytes don't hash to the file's name.",
      });
      return;
    }
    if (existsSync(target)) await rm(scratch, { force: true });
    else renameSync(scratch, target);
    home.uploaded(sha);
    options.stored?.(who.homeId, size);
    send(response, 201, { sha256: sha, size });
  };

  return {
    async request(request, response, path) {
      const method = request.method ?? "GET";
      if (method === "GET" && path === "/.well-known/oauth-authorization-server") {
        send(response, 200, metadata());
        return;
      }
      if (method === "GET" && path === "/.well-known/oauth-protected-resource/host") {
        send(response, 200, {
          resource: `${apiOrigin}/host`,
          authorization_servers: [apiOrigin],
          scopes_supported: ["mostra"],
        });
        return;
      }
      if (method === "POST" && path === "/oauth/device") {
        const body = await form(request);
        if (!body) {
          send(response, 400, { error: "invalid_request", error_description: "Send a form." });
          return;
        }
        const answer = auth.device(body);
        if ("error" in answer && typeof answer["status"] === "number") {
          const failed = answer as unknown as {
            status: number;
            error: string;
            description: string;
          };
          send(response, failed.status, {
            error: failed.error,
            error_description: failed.description,
          });
          return;
        }
        send(response, 200, answer);
        return;
      }
      if (method === "POST" && path === "/oauth/token") {
        const body = await form(request);
        if (!body) {
          send(response, 400, { error: "invalid_request", error_description: "Send a form." });
          return;
        }
        const answer = auth.token(body);
        if ("error" in answer) {
          send(response, answer.status, {
            error: answer.error,
            error_description: answer.description,
          });
          return;
        }
        send(response, 200, answer);
        return;
      }
      if (method === "POST" && path === "/oauth/revoke") {
        const body = await form(request);
        if (body) auth.revoke(body);
        send(response, 200, {});
        return;
      }
      if (path === "/device") {
        const provider = developmentProvider(config);
        if (method === "GET") {
          const code = new URL(request.url ?? "/", apiOrigin).searchParams.get("user_code") ?? "";
          page(response, 200, devicePage({ code, provider }));
          return;
        }
        if (method === "POST") {
          // The page's own form only: a cross-site form post approves nothing.
          if (request.headers.origin !== apiOrigin) {
            page(
              response,
              403,
              devicePage({ code: "", provider, message: "This form must be sent from this page." }),
            );
            return;
          }
          const body = await form(request);
          const code = body?.get("user_code") ?? "";
          const name = (body?.get("name") ?? "").trim().slice(0, 64);
          if (!body || !provider || body.get("provider") !== provider.id || name === "") {
            page(
              response,
              400,
              devicePage({ code, provider, message: "Enter the code and your name." }),
            );
            return;
          }
          const approve = body.get("decision") === "approve";
          const decided = auth.decide({
            code,
            approve,
            identity: { provider: provider.id, subject: name.toLowerCase(), name },
          });
          if (!decided.ok) {
            page(response, 400, devicePage({ code, provider, message: decided.reason }));
            return;
          }
          page(
            response,
            200,
            devicePage({
              code,
              provider,
              done: true,
              message: approve
                ? "The machine is linked to your account."
                : "The sign-in was refused.",
            }),
          );
          return;
        }
      }
      const file = /^\/files\/([0-9a-f]{64})$/.exec(path);
      if (file && method === "PUT") {
        await upload(request, response, file[1] as string);
        return;
      }
      send(response, 404, {
        code: "MOSTRA_HYGIENE_NOT_SERVED",
        message: "Nothing is served at this path.",
      });
    },

    upgrade(request, socket, head, path) {
      const refuse = (status: number, text: string, extra = ""): void => {
        socket.end(
          `HTTP/1.1 ${status} ${text}\r\nconnection: close\r\ncontent-length: 0\r\n${extra}\r\n`,
        );
      };
      if (path !== "/host") {
        refuse(404, "Not Found");
        return;
      }
      const who = bearer(request);
      if (!who) {
        refuse(
          401,
          "Unauthorized",
          `www-authenticate: Bearer resource_metadata="${apiOrigin}/.well-known/oauth-protected-resource/host"\r\n`,
        );
        return;
      }
      if (options.suspended?.(who.homeId)) {
        refuse(403, "Forbidden");
        return;
      }
      void options.home(who.homeId).then(
        (home) => {
          sockets.handleUpgrade(request, socket, head, (ws) => {
            bindings.add(ws);
            bindingHomes.set(ws, who.homeId);
            let expiresAt = who.expiresAt;
            const attributes = {
              accountId: who.accountId,
              grantId: who.grantId,
              homeId: who.homeId,
              linkId: who.linkId,
              replaceToken: (next: number) => {
                expiresAt = next;
              },
            };
            // The binding ends at its token's expiry unless refreshed in band (`remote/token`), and
            // within 60 s of the grant's revocation or the account's suspension (§18.2).
            const watch = setInterval(
              () => {
                if (Date.now() >= expiresAt) {
                  log.info("binding.token_expired", { home: who.homeId });
                  ws.close(4401, "token expired");
                } else if (!auth.grantLive(who.grantId)) {
                  log.info("binding.grant_revoked", { home: who.homeId });
                  ws.close(4403, "grant revoked");
                }
              },
              Math.min(GRANT_RECHECK_MS, options.recheckMs ?? GRANT_RECHECK_MS),
            );
            watch.unref();
            ws.once("close", () => {
              clearInterval(watch);
              bindings.delete(ws);
              bindingHomes.delete(ws);
            });
            ws.on("message", () => {
              options.touch(who.homeId);
              options.message?.(who.homeId);
            });
            serveWebSocket(home.protocol, ws, { attributes, log });
            log.info("binding.opened", { home: who.homeId, link: who.linkId });
          });
        },
        (error: unknown) => {
          log.error("binding.home_failed", { home: who.homeId, error });
          refuse(503, "Service Unavailable");
        },
      );
    },

    closeHome(homeId) {
      for (const [ws, home] of bindingHomes) {
        if (home === homeId) ws.close(4403, "home unavailable");
      }
    },

    close() {
      for (const ws of bindings) ws.terminate();
      sockets.close();
    },
  };
}
