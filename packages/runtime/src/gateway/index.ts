/**
 * The gateway (ARCHITECTURE §5, §10; D38, D96 to D99): the HTTP side of an instance. It serves
 * the shell on the shell's leased port and each opened artifact on its own leased port, all on one
 * host, so the shell and every artifact are same-site but different origins. Only capability
 * holders get in: a link's token becomes a shell session, the shell hands the artifact's frame a
 * single-use ticket, and the frame's session lets it load its version's files. Every request goes
 * through the same checks (`routes.ts`), and published versions are served straight from disk,
 * with no process (RT-05). It also serves `view/url`, `view/rotate` and `view/revoke`.
 *
 * ```ts
 * const gateway = createGateway({ ledger, log, addressing, capabilities, artifacts, shellDir });
 * await gateway.start();
 * const { url } = await gateway.defaultLink(artifactId); // the publish receipt's URL
 * ```
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type ArtifactDetail,
  ArtifactId,
  type ArtifactRef,
  type CapabilityLink,
  type CapabilityScope,
  createDiagnostic,
  durationMs,
  type Refusal,
  RpcError,
  refusal,
  safePath,
  viewRevokeMethod,
  viewRotateMethod,
  viewUrlMethod,
} from "@mostra/protocol";
import type { Addressing } from "../addressing/index.ts";
import { runtimeRoot } from "../deps/index.ts";
import type { Ledger, LedgerDb } from "../ledger/index.ts";
import type { Environment, Log } from "../log.ts";
import { handler, type MethodHandler } from "../protocol-server/index.ts";
import { type Capabilities, type MintedToken, SESSION_MAX_AGE_S } from "./capabilities.ts";
import {
  BASE_HEADERS,
  cookieValues,
  documentHeaders,
  isRefusal,
  jsonResponse,
  type ListenerKind,
  readJsonObject,
  sessionCookie,
} from "./http.ts";
import { createListener, type Listener } from "./listener.ts";
import { type ListenerChecks, mount, type RouteContext, type RouteSpec, refuse } from "./routes.ts";
import { fileResponse, findFile } from "./serve.ts";

export { Capabilities, capabilityKey } from "./capabilities.ts";

/** What the gateway reads about artifacts and versions. */
export interface GatewayArtifacts {
  /** An artifact in full; throws `MOSTRA_ARTIFACT_NOT_FOUND` for an unknown one. */
  get(ref: ArtifactRef): ArtifactDetail;
  /** The directory of a published version (`versions/<id>`). */
  versionDir(versionId: string): string;
}

/** Options for {@link createGateway}. */
export interface GatewayOptions {
  readonly ledger: Ledger;
  readonly log: Log;
  readonly addressing: Addressing;
  readonly capabilities: Capabilities;
  readonly artifacts: GatewayArtifacts;
  /** The shell's built files, or `undefined` when the runtime lacks them (`MOSTRA_ENV_SHELL_MISSING`). */
  readonly shellDir: string | undefined;
}

/** The gateway of one instance. */
export interface Gateway {
  /** Binds the shell's port and every leased artifact port (D99). */
  start(): Promise<void>;
  /** The shell's origin. */
  readonly shellOrigin: () => string;
  /** The artifact's default link (D97 item 3), shown again or minted: the publish receipt's URL. */
  defaultLink(artifactId: string): { readonly url: string; readonly tokenId: string };
  /** The handlers of `view/url`, `view/rotate` and `view/revoke`. */
  methods(): MethodHandler[];
  /** The origins of the artifact listeners that are bound, by artifact ID. */
  artifactOrigins(): ReadonlyMap<string, string>;
  /** Stops every listener. */
  close(): Promise<void>;
}

/** A frame ticket's answer to the shell. */
interface TicketAnswer {
  readonly src: string;
  readonly artifactOrigin: string;
  readonly version: { readonly id: string; readonly number: number };
  readonly latest: { readonly number: number };
}

const NO_STORE = { "cache-control": "no-store" };

/** The browser-protocol routes of INTERFACES §4 that later packages serve (D96). */
function laterArtifactRoutes(): RouteSpec[] {
  const action = (params: Readonly<Record<string, string>>): CapabilityScope | "any-action" => {
    const id = params["fn"];
    return id ? (`action:${id}` as CapabilityScope) : "any-action";
  };
  return [
    { method: "GET", path: "/_mostra/sw.js", intent: "read", auth: "none" },
    {
      method: "POST",
      path: "/_mostra/v/:rev/fields",
      intent: "mutation",
      auth: "session",
      scope: () => "draft",
    },
    {
      method: "POST",
      path: "/_mostra/v/:rev/submit",
      intent: "mutation",
      auth: "session",
      scope: () => "submit",
    },
    { method: "POST", path: "/_mostra/v/:rev/signal", intent: "mutation", auth: "session" },
    // A function ID may hold `/` (`lib/mail.ts#send`), so the call path takes the rest of the path.
    {
      method: "POST",
      path: "/_mostra/v/:rev/call/:fn{.+}",
      intent: "mutation",
      auth: "session",
      scope: action,
    },
    {
      method: "POST",
      path: "/_mostra/v/:rev/runs",
      intent: "mutation",
      auth: "session",
      scope: () => "any-action",
    },
    {
      method: "POST",
      path: "/_mostra/v/:rev/runs/:run/cancel",
      intent: "mutation",
      auth: "session",
      scope: () => "any-action",
    },
    { method: "POST", path: "/_mostra/v/:rev/ticket", intent: "mutation", auth: "session" },
    { method: "GET", path: "/_mostra/v/:rev/events", intent: "stream", auth: "session" },
    { method: "GET", path: "/_mostra/v/:rev/events/poll", intent: "stream", auth: "session" },
  ];
}

/** Creates the gateway; nothing is bound until {@link Gateway.start}. */
export function createGateway(options: GatewayOptions): Gateway {
  const { addressing, capabilities, artifacts, log } = options;
  let shellPort: number | undefined;
  const shellOrigin = (): string => {
    if (shellPort === undefined) throw new Error("The gateway hasn't started.");
    return addressing.origin(shellPort);
  };
  const artifactListeners = new Map<
    string,
    { readonly listener: Listener; readonly port: number }
  >();
  const opening = new Map<string, Promise<number>>();

  const link = (token: MintedToken): CapabilityLink => ({
    url: `${shellOrigin()}/a/${token.artifactId}${token.pinnedVersion !== undefined ? `/v/${token.pinnedVersion}` : ""}#t=${token.secret}`,
    tokenId: token.tokenId,
    scopes: token.scopes,
    ...(token.expiresAt !== undefined ? { expiresAt: token.expiresAt } : {}),
  });

  /** The version a request names (number or ID), or the latest; `undefined` when there is none. */
  const versionOf = (
    detail: ArtifactDetail,
    wanted: number | string | undefined,
  ): { readonly id: string; readonly number: number } | undefined => {
    const found =
      wanted === undefined
        ? (detail.latestVersion ?? detail.versions[0])
        : detail.versions.find((version) =>
            typeof wanted === "number" ? version.number === wanted : version.id === wanted,
          );
    return found ? { id: found.id, number: found.number } : undefined;
  };

  // ── The shell ────────────────────────────────────────────────────────────────────────────

  const shellKind = (): ListenerKind => ({
    kind: "shell",
    origin: shellOrigin(),
    shellOrigin: shellOrigin(),
  });
  const shellChecks: ListenerChecks = {
    policy: () => ({ origin: shellOrigin(), hosts: addressing.hosts(shellPort ?? 0) }),
    capabilities,
    log,
    cookieName: () => `mostra-${shellPort}`,
    frameAncestors: () => "'none'",
    artifactOf: (params) => {
      const id = params["artifactId"];
      return id !== undefined && ArtifactId.is(id) ? id : undefined;
    },
  };

  const shellMissing = (): Response =>
    jsonResponse(
      createDiagnostic("MOSTRA_ENV_SHELL_MISSING", {
        message: "This Mostra runtime has no built shell.",
      }),
      { status: 503 },
    );

  /** The shell's page: the same for every artifact; it learns everything from its session. */
  const shellPage = (context: RouteContext): Response => {
    if (options.shellDir === undefined) return shellMissing();
    if (context.artifactId === undefined) {
      return refuse(
        shellChecks,
        refusal("MOSTRA_HYGIENE_NOT_SERVED", "No artifact is named at this path."),
        {
          method: context.request.method,
          path: new URL(context.request.url).pathname,
          document: true,
        },
      );
    }
    const html = readFileSync(join(options.shellDir, "index.html"));
    return new Response(context.request.method === "HEAD" ? null : html, {
      headers: {
        ...BASE_HEADERS,
        ...documentHeaders(shellKind(), `http://${addressing.urlHost}:*`),
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  };

  const shellAsset = async (context: RouteContext): Promise<Response> => {
    if (options.shellDir === undefined) return shellMissing();
    const url = new URL(context.request.url);
    const path = safePath(url.pathname)?.slice("/_mostra/shell".length) ?? "";
    const file = path.startsWith("/assets/") ? await findFile(options.shellDir, path) : undefined;
    if (!file) {
      return refuse(
        shellChecks,
        refusal("MOSTRA_HYGIENE_NOT_SERVED", "No shell file at this path."),
        {
          method: context.request.method,
          path: url.pathname,
          document: false,
        },
      );
    }
    return fileResponse(file, context.request, {
      ...documentHeaders(shellKind(), `http://${addressing.urlHost}:*`),
      "cache-control": "public, max-age=31536000, immutable",
    });
  };

  /** The session's facts, for the shell and the frame alike. */
  const sessionFacts = (
    artifactId: string,
    grant: { readonly scopes: readonly string[]; readonly expiresAt?: string },
  ) => {
    const detail = artifacts.get({ artifactId });
    return {
      artifact: { id: detail.id, title: detail.title },
      scopes: grant.scopes,
      ...(grant.expiresAt !== undefined ? { expiresAt: grant.expiresAt } : {}),
    };
  };

  const exchange = async (context: RouteContext): Promise<Response> => {
    const artifactId = context.artifactId as string;
    const meta = { method: "POST", path: new URL(context.request.url).pathname, document: false };
    const body = await readJsonObject(context.request);
    if (isRefusal(body)) return refuse(shellChecks, body, meta);
    const grant = capabilities.presentToken(body["token"], artifactId);
    if (isRefusal(grant)) return refuse(shellChecks, grant, meta);
    const session = capabilities.createSession({ tokenId: grant.tokenId, origin: shellOrigin() });
    log.info("gateway.session_started", {
      origin: shellOrigin(),
      artifactId,
      tokenId: grant.tokenId,
    });
    return jsonResponse(
      { csrf: session.csrf, ...sessionFacts(artifactId, grant) },
      {
        headers: {
          "set-cookie": sessionCookie(
            shellChecks.cookieName(),
            session.cookie,
            `/a/${artifactId}`,
            SESSION_MAX_AGE_S,
          ),
        },
      },
    );
  };

  const readShellSession = (context: RouteContext): Response => {
    const session = context.session;
    if (!session || context.artifactId === undefined)
      throw new Error("session route without a session");
    return jsonResponse({ csrf: session.csrf, ...sessionFacts(context.artifactId, session.grant) });
  };

  const ticket = async (context: RouteContext): Promise<Response> => {
    const session = context.session;
    const artifactId = context.artifactId;
    if (!session || artifactId === undefined) throw new Error("session route without a session");
    const meta = { method: "POST", path: new URL(context.request.url).pathname, document: false };
    const body = await readJsonObject(context.request);
    if (isRefusal(body)) return refuse(shellChecks, body, meta);
    const asked = body["version"];
    if (asked !== undefined && !(Number.isSafeInteger(asked) && (asked as number) >= 1)) {
      return refuse(
        shellChecks,
        refusal("MOSTRA_HYGIENE_REQUEST_MALFORMED", "`version` must be a version number."),
        meta,
      );
    }
    const detail = artifacts.get({ artifactId });
    const version = versionOf(detail, (asked as number | undefined) ?? session.grant.pinnedVersion);
    const latest = versionOf(detail, undefined);
    if (!version || !latest) {
      return jsonResponse(
        createDiagnostic("MOSTRA_ARTIFACT_VERSION_NOT_FOUND", {
          message:
            `This artifact has no version ${asked ?? session.grant.pinnedVersion ?? ""}.`.replace(
              " .",
              ".",
            ),
        }),
        { status: 404 },
      );
    }
    const port = await openArtifact(artifactId);
    const artifactOrigin = addressing.origin(port);
    if (addressing.frameMode(shellOrigin(), artifactOrigin) === "worker") {
      // Cross-site frames use worker mode (D70), which WP-13 builds; nothing here pretends otherwise.
      return refuse(
        shellChecks,
        refusal("MOSTRA_HYGIENE_NOT_SERVED", "Cross-site frame sessions arrive with sharing.", 501),
        meta,
      );
    }
    const value = capabilities.mintTicket({
      tokenId: session.grant.tokenId,
      artifactId,
      versionId: version.id,
      origin: artifactOrigin,
      shellOrigin: shellOrigin(),
    });
    const answer: TicketAnswer = {
      src: `${artifactOrigin}/_mostra/enter?ticket=${value}`,
      artifactOrigin,
      version,
      latest: { number: latest.number },
    };
    return jsonResponse(answer);
  };

  const shellRoutes: RouteSpec[] = [
    { method: "GET", path: "/a/:artifactId", intent: "read", auth: "none", handler: shellPage },
    { method: "GET", path: "/a/:artifactId/", intent: "read", auth: "none", handler: shellPage },
    {
      method: "GET",
      path: "/a/:artifactId/v/:number{[1-9][0-9]{0,8}}",
      intent: "read",
      auth: "none",
      handler: shellPage,
    },
    { method: "GET", path: "/_mostra/shell/*", intent: "read", auth: "none", handler: shellAsset },
    {
      method: "POST",
      path: "/a/:artifactId/_mostra/session",
      intent: "exchange",
      auth: "none",
      tokenPath: true,
      handler: exchange,
    },
    {
      method: "GET",
      path: "/a/:artifactId/_mostra/session",
      intent: "read",
      auth: "session",
      handler: readShellSession,
    },
    {
      method: "POST",
      path: "/a/:artifactId/_mostra/ticket",
      intent: "mutation",
      auth: "session",
      handler: ticket,
    },
    // Review and trusted controls (WP-07, WP-20) live here, behind the shell's session (D96).
    {
      method: "POST",
      path: "/a/:artifactId/_mostra/v/:rev/review/*",
      intent: "mutation",
      auth: "session",
      scope: () => "review",
    },
  ];

  // ── Artifacts ────────────────────────────────────────────────────────────────────────────

  const artifactRoutes = (artifactId: string, port: () => number): RouteSpec[] => {
    const origin = (): string => addressing.origin(port());
    const kind = (): ListenerKind => ({
      kind: "artifact",
      origin: origin(),
      shellOrigin: shellOrigin(),
    });
    const checks = (): ListenerChecks => artifactChecks(artifactId, port);

    const enter = (context: RouteContext): Response => {
      const url = new URL(context.request.url);
      const meta = { method: "GET", path: url.pathname, document: true };
      // A frame enters from its shell, which is same-site. A page elsewhere can navigate a hidden
      // frame here with junk tickets; its entries are refused before redeeming, so they never
      // count towards the guessing limit and can't lock real viewers out (D97 item 8).
      if (context.request.headers.get("sec-fetch-site") === "cross-site") {
        return refuse(
          checks(),
          refusal("MOSTRA_HYGIENE_ORIGIN_REFUSED", "A frame enters only from its shell."),
          meta,
        );
      }
      const redeemed = capabilities.redeemTicket(url.searchParams.get("ticket"), origin());
      if (isRefusal(redeemed)) return refuse(checks(), redeemed, meta);
      if (redeemed.artifactId !== artifactId) {
        return refuse(
          checks(),
          refusal("MOSTRA_HYGIENE_TOKEN_INVALID", "The ticket is for another artifact."),
          meta,
        );
      }
      const headers: Record<string, string> = { ...BASE_HEADERS, ...NO_STORE, location: "/" };
      // A frame that has a session from the same link keeps it and switches version (D98 item 5).
      const existing = capabilities.session(
        cookieValues(context.request.headers.get("cookie"), checks().cookieName()),
        origin(),
        artifactId,
      );
      if (!isRefusal(existing) && existing.grant.tokenId === redeemed.tokenId) {
        capabilities.enterVersion(existing.id, redeemed.versionId);
      } else {
        const session = capabilities.createSession({
          tokenId: redeemed.tokenId,
          origin: origin(),
          versionId: redeemed.versionId,
        });
        headers["set-cookie"] = sessionCookie(
          checks().cookieName(),
          session.cookie,
          "/",
          SESSION_MAX_AGE_S,
        );
        log.info("gateway.session_started", {
          origin: origin(),
          artifactId,
          tokenId: redeemed.tokenId,
        });
      }
      return new Response(null, { status: 303, headers });
    };

    const frameSession = (context: RouteContext): Response => {
      const session = context.session;
      if (!session) throw new Error("session route without a session");
      const detail = artifacts.get({ artifactId });
      const version = detail.versions.find((entry) => entry.id === session.versionId);
      return jsonResponse({
        csrf: session.csrf,
        artifactId,
        shellOrigin: shellOrigin(),
        scopes: session.grant.scopes,
        ...(version ? { version: { id: version.id, number: version.number } } : {}),
      });
    };

    const files = async (context: RouteContext): Promise<Response> => {
      const session = context.session;
      const url = new URL(context.request.url);
      const meta = {
        method: context.request.method,
        path: url.pathname,
        document: context.document,
      };
      // `checkRequest` refused unsafe targets already; an unsafe one here is still never served.
      const path = safePath(url.pathname);
      if (
        path === undefined ||
        !session?.versionId ||
        path === "/_mostra" ||
        path.startsWith("/_mostra/")
      ) {
        return refuse(
          checks(),
          refusal("MOSTRA_HYGIENE_NOT_SERVED", "Nothing is served at this path."),
          meta,
        );
      }
      const root = (versionId: string): string => join(artifacts.versionDir(versionId), "client");
      const headers = { ...documentHeaders(kind(), "") };
      let file = await findFile(root(session.versionId), path);
      // Content-hashed chunks stay reachable after another tab moved the session on (D98 item 5).
      if (!file && path.startsWith("/assets/")) {
        for (const version of artifacts.get({ artifactId }).versions) {
          if (version.id === session.versionId) continue;
          file = await findFile(root(version.id), path);
          if (file) break;
        }
      }
      if (file) {
        return fileResponse(file, context.request, {
          ...headers,
          "cache-control": path.startsWith("/assets/")
            ? "private, max-age=31536000, immutable"
            : "no-cache",
        });
      }
      // A deep link inside the artifact's routes (D57) gets its page.
      const page = context.document
        ? await findFile(root(session.versionId), "/index.html")
        : undefined;
      if (page)
        return fileResponse(page, context.request, { ...headers, "cache-control": "no-cache" });
      return refuse(
        checks(),
        refusal("MOSTRA_HYGIENE_NOT_SERVED", "This version has no file at this path."),
        meta,
      );
    };

    return [
      {
        method: "GET",
        path: "/_mostra/enter",
        intent: "read",
        auth: "none",
        tokenPath: true,
        handler: enter,
      },
      {
        method: "GET",
        path: "/_mostra/session",
        intent: "read",
        auth: "session",
        handler: frameSession,
      },
      ...laterArtifactRoutes(),
      { method: "GET", path: "/*", intent: "read", auth: "session", handler: files },
    ];
  };

  const artifactChecks = (artifactId: string, port: () => number): ListenerChecks => ({
    policy: () => ({ origin: addressing.origin(port()), hosts: addressing.hosts(port()) }),
    capabilities,
    log,
    cookieName: () => `mostra-${port()}`,
    frameAncestors: () => shellOrigin(),
    artifactOf: () => artifactId,
  });

  /** Binds the artifact's listener on its leased port, once; resolves with the port. */
  const openArtifact = (artifactId: string): Promise<number> => {
    const bound = artifactListeners.get(artifactId);
    if (bound) return Promise.resolve(bound.port);
    const pending = opening.get(artifactId);
    if (pending) return pending;
    const started = (async () => {
      let port = 0;
      const listener = createListener({
        policy: () => ({ origin: addressing.origin(port), hosts: addressing.hosts(port) }),
        log,
        frameAncestors: () => shellOrigin(),
        configure: (app) =>
          mount(
            app,
            artifactChecks(artifactId, () => port),
            artifactRoutes(artifactId, () => port),
          ),
      });
      port = await addressing.listen(listener.server, { purpose: "artifact", owner: artifactId });
      artifactListeners.set(artifactId, { listener, port });
      log.info("gateway.artifact_listening", { artifactId, origin: addressing.origin(port) });
      return port;
    })().finally(() => opening.delete(artifactId));
    opening.set(artifactId, started);
    return started;
  };

  let shellListener: Listener | undefined;

  // ── View methods ─────────────────────────────────────────────────────────────────────────

  /** Replays a recorded request, or runs `fn` and records `{ tokenId }` in the same transaction. */
  const recorded = (
    method: string,
    requestId: string | undefined,
    fn: (db: LedgerDb) => MintedToken,
  ): CapabilityLink => {
    const token = options.ledger.write((db) => {
      if (requestId !== undefined) {
        const row = db.get<{ result_json: string }>(
          "SELECT result_json FROM request WHERE method = ? AND request_id = ?",
          method,
          requestId,
        );
        if (row) return { replay: (JSON.parse(row.result_json) as { tokenId: string }).tokenId };
      }
      const minted = fn(db);
      if (requestId !== undefined) {
        // Only the token ID is recorded: the ledger never holds a link's secret (D97 item 2).
        db.run(
          "INSERT INTO request (method, request_id, result_json, created_at) VALUES (?, ?, ?, ?)",
          method,
          requestId,
          JSON.stringify({ tokenId: minted.tokenId }),
          new Date().toISOString(),
        );
      }
      return { minted };
    });
    if ("minted" in token) return link(token.minted);
    const shown = capabilities.reveal(token.replay);
    if (!shown) {
      throw new RpcError(
        createDiagnostic("MOSTRA_HYGIENE_TOKEN_REVOKED", {
          message:
            "The link this request created can't be shown again: the home's capability key changed.",
        }),
      );
    }
    return link(shown);
  };

  const fail = (refused: Refusal): never => {
    throw new RpcError(refused.diagnostic);
  };

  return {
    shellOrigin,
    async start() {
      const pruned = capabilities.prune();
      if (pruned > 0) log.info("gateway.sessions_pruned", { count: pruned });
      shellListener = createListener({
        policy: () => shellChecks.policy(),
        log,
        frameAncestors: () => "'none'",
        configure: (app) => mount(app, shellChecks, shellRoutes),
      });
      shellPort = await addressing.listen(shellListener.server, {
        purpose: "shell",
        owner: "shell",
      });
      log.info("gateway.listening", { origin: shellOrigin(), bind: addressing.bindAddress });
      // Leased artifact ports are bound now, so their frames reload after a restart (D62, FAILURE_MODEL §8).
      for (const lease of addressing.leases()) {
        if (lease.purpose !== "artifact") continue;
        try {
          artifacts.get({ artifactId: lease.owner });
        } catch {
          continue;
        }
        await openArtifact(lease.owner);
      }
    },
    defaultLink(artifactId) {
      const { url, tokenId } = link(capabilities.defaultLink(artifactId));
      return { url, tokenId };
    },
    methods: () => [
      handler(viewUrlMethod, (params) => {
        const detail = artifacts.get(params.artifact);
        const version = versionOf(detail, params.version);
        if (!version) {
          throw new RpcError(
            createDiagnostic("MOSTRA_ARTIFACT_VERSION_NOT_FOUND", {
              message:
                params.version === undefined
                  ? `The artifact ${detail.id} has no published version.`
                  : `The artifact ${detail.id} has no version ${params.version}.`,
            }),
          );
        }
        return recorded("view/url", params.requestId, (db) =>
          capabilities.mint(
            {
              artifactId: detail.id,
              scopes: params.scopes,
              ttlMs: params.ttl === undefined ? undefined : durationMs(params.ttl),
              pinnedVersion: params.version === undefined ? undefined : version.number,
            },
            db,
          ),
        );
      }),
      handler(viewRotateMethod, (params) =>
        recorded("view/rotate", params.requestId, (db) => {
          const rotated = capabilities.rotate(params.tokenId, db);
          if (rotated === undefined) {
            return fail(
              refusal(
                "MOSTRA_HYGIENE_TOKEN_INVALID",
                `No capability token ${params.tokenId} exists in this home.`,
              ),
            );
          }
          if (rotated === "dead") {
            return fail(
              refusal(
                "MOSTRA_HYGIENE_TOKEN_REVOKED",
                `The token ${params.tokenId} was revoked or has expired.`,
              ),
            );
          }
          return rotated;
        }),
      ),
      handler(viewRevokeMethod, (params) => {
        // Revoking is idempotent by itself, so a retried request needs no record.
        const outcome = capabilities.revoke(params.tokenId);
        if (outcome === "unknown") {
          fail(
            refusal(
              "MOSTRA_HYGIENE_TOKEN_INVALID",
              `No capability token ${params.tokenId} exists in this home.`,
            ),
          );
        }
        if (outcome === "revoked") log.info("gateway.token_revoked", { tokenId: params.tokenId });
        return {};
      }),
    ],
    artifactOrigins: () =>
      new Map(
        [...artifactListeners].map(([artifactId, entry]) => [
          artifactId,
          addressing.origin(entry.port),
        ]),
      ),
    async close() {
      await Promise.allSettled([...opening.values()]);
      await Promise.all([
        shellListener?.close(),
        ...[...artifactListeners.values()].map((entry) => entry.listener.close()),
      ]);
    },
  };
}

/**
 * Finds the shell's built files: `MOSTRA_SHELL_DIR`, else `shell/dist` beside the runtime package,
 * as the runtime bundle and this repository lay them out. `undefined` when they're missing: the
 * instance still starts, artifact frames are still served, and the shell's pages answer
 * `MOSTRA_ENV_SHELL_MISSING`.
 */
export function locateShell(env: Environment): string | undefined {
  const dir = env["MOSTRA_SHELL_DIR"] ?? resolve(runtimeRoot(), "..", "shell", "dist");
  return existsSync(join(dir, "index.html")) ? dir : undefined;
}
