/**
 * The remote server (ARCHITECTURE §15, INTERFACES §18, D165): one process holding many hosted
 * homes behind one listener. It speaks plain HTTP behind a TLS terminator and routes every request
 * by its exact `Host`: the API origin (the network binding, version files, sign-in) or a
 * user-content domain (the hosted shell on its apex, an artifact's pages on its route's label).
 * It runs no artifact code: server code runs on each artifact's owner instance, through the relay.
 *
 * ```ts
 * const server = await startServer({ data: "/var/lib/mostra", config: readServerConfig(file, env), … });
 * // … mostra-runtime server serves until it is stopped
 * await server.close();
 * ```
 */

import { readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { getRequestListener } from "@hono/node-server";
import {
  createDiagnostic,
  type Diagnostic,
  type Duration,
  durationMs,
  RouteId,
  RpcError,
} from "@mostra/protocol";
import { faultsFrom } from "../faults.ts";
import {
  BASE_HEADERS,
  defaultPages,
  documentHeaders,
  locateShell,
  MADE_WITH_HREF,
  refusalDocument,
  resetOnClose,
  type ServerPages,
  serverPages,
  shellAssetResponse,
  THEME_BASE,
  themePageCsp,
} from "../gateway/index.ts";
import { appendEvent } from "../interaction/index.ts";
import type { Ledger, LedgerOwner } from "../ledger/index.ts";
import type { Environment, Log } from "../log.ts";
import { type Api, createApi } from "./api.ts";
import { type Authorization, createAuthorization } from "./auth.ts";
import { type Authorize, createAuthorize } from "./authorize.ts";
import { clientAddresses, RateLimiter } from "./clients.ts";
import type { RemoteServerConfig } from "./config.ts";
import { type DataDirectory, type HomeAssembler, openDataDirectory } from "./data.ts";
import { createHandle } from "./handle.ts";
import { type HostedHome, type HostedServices, openHostedHome } from "./hosted.ts";
import { type HomeOwner, homeUnavailable } from "./hosted-pages.ts";
import { createRemoteMcp, serverDocs } from "./mcp.ts";
import { createMeter, heldLevels, type Meter } from "./metering.ts";
import { APPEARANCE_PATH, createApiPages } from "./pages.ts";
import { createClients } from "./oauth-clients.ts";
import { loadOperator, type Operator } from "./operator.ts";
import { type BuiltInProvider, builtInProviders } from "./providers.ts";
import { createRouting, type Destination, type Routing } from "./routing.ts";

export { type RemoteServerConfig, readServerConfig } from "./config.ts";

/** Options for {@link startServer}. */
export interface ServerOptions {
  /** The data directory (`--data`). */
  readonly data: string;
  readonly config: RemoteServerConfig;
  /** `host:port` to listen on (`--listen`). Default `127.0.0.1:8080`. */
  readonly listen?: string;
  /** Homes restored from a backup by hand (`--restored`): their incarnations rotate first. */
  readonly restored?: readonly string[];
  readonly runtimeVersion: string;
  readonly owner: LedgerOwner;
  readonly log: Log;
  readonly env: Environment;
}

/** A running remote server. */
export interface RemoteServer {
  /** Where it listens: `http://host:port`. */
  readonly address: string;
  readonly config: RemoteServerConfig;
  /** Stops listening, closes every hosted home, then the directory, and releases the locks. */
  close(): Promise<void>;
}

/** An answer as JSON, with the headers every server answer carries. */
function json(response: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(text);
}

/** Whether a request is a person's navigation, answered with a page rather than JSON. */
function wantsPage(request: IncomingMessage | undefined): boolean {
  if (!request) return false;
  const dest = request.headers["sec-fetch-dest"];
  if (typeof dest === "string") return dest === "document";
  return (request.headers.accept ?? "").includes("text/html");
}

/**
 * A refusal: a page in the server's theme for a person's navigation (an unknown host, a request
 * the server couldn't answer), the diagnostic as JSON for anything else.
 */
function refusal(
  response: ServerResponse,
  status: number,
  diagnostic: Diagnostic,
  pages: ServerPages = defaultPages(),
): void {
  const request = response.req as IncomingMessage | undefined;
  if (!wantsPage(request)) {
    json(response, status, diagnostic);
    return;
  }
  const text = refusalDocument(pages.pages, {
    title: diagnostic.message,
    detail: diagnostic.hint,
    code: diagnostic.code,
  });
  response.writeHead(status, {
    ...BASE_HEADERS,
    "content-type": "text/html; charset=utf-8",
    "content-length": String(Buffer.byteLength(text)),
    "cache-control": "no-store",
    "content-security-policy": themePageCsp(pages.pages),
    "x-frame-options": "DENY",
  });
  response.end(request?.method === "HEAD" ? undefined : text);
}

/** Splits `host:port`, with `[::1]:port` for IPv6. */
function parseListen(listen: string): { host: string; port: number } {
  const match = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(listen);
  if (!match) {
    throw new RpcError(
      createDiagnostic("MOSTRA_REMOTE_CONFIG_INVALID", {
        message: `--listen ${listen} isn't host:port.`,
      }),
    );
  }
  return { host: (match[1] as string).replace(/^\[|\]$/g, ""), port: Number(match[2]) };
}

/** Starts the remote server: its data directory, then its listener. */
export async function startServer(options: ServerOptions): Promise<RemoteServer> {
  const { config, log } = options;
  // The authorization server and the operator module are made once the directory is open; homes
  // open only after both.
  let auth: Authorization | undefined;
  // The hosted hosts' own pages, once the configuration's are made (below); the defaults until then.
  let pagesOfHosts: ServerPages = defaultPages();
  let operator: Operator | undefined;
  let meter: Meter | undefined;
  let routing: Routing;
  let authorizer: Authorize | undefined;
  let api: Api | undefined;
  const shellDir = locateShell(options.env);
  const clients = clientAddresses({
    trustedProxies: config.trustedProxies,
    ipv6Prefix: config.rateLimits?.ipv6Prefix,
  });
  const rates = new RateLimiter();
  const faults = faultsFrom(options.env);
  const rateOf = (rate: { count: number; per: string } | undefined) =>
    rate === undefined ? undefined : { count: rate.count, perMs: durationMs(rate.per as Duration) };
  /**
   * `rateLimits.perIp.requests`: every request to the server, from one client address (IPv6 per
   * /64), API origin and hosted hosts alike, before anything else is read (D165 item 13). A
   * health check is never counted. Without the setting there is no limit.
   */
  const perIpRequests = rateOf(config.rateLimits?.perIp?.requests);
  /**
   * Who owns a home, as its pages' sender line names them (D161): the account's name, and the
   * verifier its first identity recorded when its provider named the person (MT-03), never the
   * configuration now, so a provider renamed or retired since changes no sender line. A name the
   * development provider took on trust, or one no provider verified, carries none.
   */
  const ownerOf = (homeId: string): HomeOwner => {
    const row = data.directory.read((db) =>
      db.get<{ account: string; name: string | null; verified_by: string | null }>(
        `SELECT a.id AS account, a.name, i.verified_by
           FROM home h JOIN account a ON a.id = h.owner_account_id
           LEFT JOIN identity i ON i.rowid = (SELECT rowid FROM identity WHERE account_id = a.id
             ORDER BY linked_at, rowid LIMIT 1)
          WHERE h.id = ?`,
        homeId,
      ),
    );
    if (!row) return { account: "" };
    return {
      account: row.account,
      ...(row.name !== null ? { name: row.name } : {}),
      ...(row.verified_by !== null ? { verifiedBy: row.verified_by } : {}),
    };
  };
  const services = (): HostedServices => ({
    operator: operator as Operator,
    clients,
    rates,
    rateLimits: {
      perIpSubmissions: rateOf(config.rateLimits?.perIp?.submissions),
      perLinkSubmissions: rateOf(config.rateLimits?.perLink?.submissions),
    },
    owner: ownerOf,
    meter: meter as Meter,
    routing,
    signin: {
      start: (signin, challenge) => (authorizer as Authorize).startViewerSignin(signin, challenge),
      finish: (input) => (authorizer as Authorize).finishViewerSignin(input),
    },
    signInOffered: () =>
      (config.identityProviders?.length ?? 0) > 0 || (operator?.has.identity ?? false),
    // On by default for every page, self-hosted included; an operator's `policy.link` turns it
    // off for the pages it promises unbranded (D171 item 5).
    madeWith: { href: MADE_WITH_HREF },
    pages: () => pagesOfHosts,
  });
  const assembler: HomeAssembler<HostedHome> = {
    assemble: (home) =>
      openHostedHome({
        faults,
        id: home.id,
        dir: home.dir,
        ledger: home.ledger,
        incarnation: home.incarnation,
        directory: data.directory,
        filesDir: join(options.data, "files"),
        auth: auth as Authorization,
        runtimeVersion: options.runtimeVersion,
        log,
        scheme: config.scheme ?? "https",
        domains: { active: config.domains.active, spares: config.domains.spares ?? [] },
        shellDir,
        services: services(),
        ...(Number(options.env["MOSTRA_TEST_SESSION_TOUCH_MS"]) > 0
          ? { sessionTouchMs: Number(options.env["MOSTRA_TEST_SESSION_TOUCH_MS"]) }
          : {}),
        relay: {
          waitingRunsPerArtifact: config.relay?.waitingRunsPerArtifact,
          drainPerSecond: config.relay?.drainPerSecond,
          ...(config.rateLimits?.perLink?.relayedRuns
            ? {
                perLink: {
                  count: config.rateLimits.perLink.relayedRuns.count,
                  perMs: durationMs(config.rateLimits.perLink.relayedRuns.per as Duration),
                },
              }
            : {}),
          ...(options.env["MOSTRA_TEST_RELAY_LIVE_MS"] !== undefined
            ? { liveRenewMs: Number(options.env["MOSTRA_TEST_RELAY_LIVE_MS"]) }
            : {}),
          ...(options.env["MOSTRA_TEST_RELAY_SWEEP_MS"] !== undefined
            ? { sweepMs: Number(options.env["MOSTRA_TEST_RELAY_SWEEP_MS"]) }
            : {}),
        },
      }),
    disassemble: (home) => home.stop(),
    incarnation: (home) => home.incarnation(),
    busy: (home) => home.busy(),
  };
  const data: DataDirectory<HostedHome> = await openDataDirectory({
    dir: options.data,
    runtimeVersion: options.runtimeVersion,
    owner: options.owner,
    log,
    env: options.env,
    assembler,
    ...(options.restored !== undefined ? { restored: options.restored } : {}),
    ...(config.homes?.idleCloseMinutes !== undefined
      ? { idleCloseMs: config.homes.idleCloseMinutes * 60_000 }
      : {}),
    ...(config.ledger?.walAutocheckpoint !== undefined
      ? { walAutocheckpoint: config.ledger.walAutocheckpoint }
      : {}),
  });
  const handle = createHandle({
    apiOrigin: config.apiOrigin,
    data: () => data,
    directory: () => data.directory,
    suspended: (homeId) => api?.closeHome(homeId),
    log,
  });
  try {
    operator = await loadOperator({
      path: config.operator,
      handle,
      directory: data.directory,
      log,
      // An invitation's link is built when it is handed over, never kept in the queue (D168).
      invitationLink: async (homeId, tokenId) => {
        // A home the directory no longer has can't build a link: its invitations go, while one
        // that is only closed, drained or failing to open is tried again later.
        const known = data.directory.read((db) =>
          db.get("SELECT 1 FROM home WHERE id = ?", homeId),
        );
        if (known === undefined) return undefined;
        return (await data.home(homeId)).assembled.invitationLink(tokenId);
      },
      ...(Number(options.env["MOSTRA_TEST_OPERATOR_DISPATCH_MS"]) > 0
        ? { dispatchMs: Number(options.env["MOSTRA_TEST_OPERATOR_DISPATCH_MS"]) }
        : {}),
    });
  } catch (error) {
    await data.close();
    throw error;
  }
  // A held file recorded before sizes were kept (directory migration 6) takes its stored size once.
  fillHeldSizes(data.directory, join(options.data, "files"), log);
  routing = createRouting({
    apiHost: new URL(config.apiOrigin).host,
    domains: () => [config.domains.active, ...(config.domains.spares ?? [])],
    active: () => config.domains.active,
    directory: data.directory,
    operator,
    log,
  });
  meter = createMeter({
    operator,
    keysDir: join(options.data, "keys"),
    log,
    ...(Number(options.env["MOSTRA_TEST_METER_WINDOW_MS"]) > 0
      ? { windowMs: Number(options.env["MOSTRA_TEST_METER_WINDOW_MS"]) }
      : {}),
    activeHomes: () => data.open().map((home) => ({ home, account: ownerOf(home).account })),
    // `bytes.held` (MT-03): each home's running total, sent when it changed, and all in a snapshot.
    held: heldLevels(data.directory),
    ...(Number(options.env["MOSTRA_TEST_HELD_SNAPSHOT_MS"]) > 0
      ? { snapshotMs: Number(options.env["MOSTRA_TEST_HELD_SNAPSHOT_MS"]) }
      : {}),
  });
  auth = createAuthorization({
    directory: data.directory,
    config,
    log,
    operator,
    ...(Number(options.env["MOSTRA_TEST_ACCESS_TTL_MS"]) > 0
      ? { accessTtlMs: Number(options.env["MOSTRA_TEST_ACCESS_TTL_MS"]) }
      : {}),
    ...(Number(options.env["MOSTRA_TEST_ROTATION_GRACE_MS"]) > 0
      ? { rotationGraceMs: Number(options.env["MOSTRA_TEST_ROTATION_GRACE_MS"]) }
      : {}),
    // A new instance link is a hosted event the account's instances see (§18.5).
    linked: ({ homeId, linkId, name }) => {
      void data.home(homeId).then(
        (home) =>
          home.assembled.ledger.write((db) =>
            appendEvent(db, {
              artifactId: null,
              type: "instance.linked",
              actor: { kind: "mostra" },
              payload: { instanceId: linkId, name },
            }),
          ),
        (error: unknown) => log.error("server.linked_event_failed", { home: homeId, error }),
      );
    },
  });
  // The authorization server's clients and browser pages (INTERFACES §18.5).
  const scheme = config.scheme ?? "https";
  const oauthClients = createClients({
    directory: data.directory,
    log,
    env: options.env,
    isShellOrigin: (origin) => {
      if (!origin.startsWith(`${scheme}://`)) return false;
      const host = origin.slice(scheme.length + 3);
      if (domains.includes(host)) return true;
      return (
        data.directory.read((db) => db.get("SELECT 1 FROM operator_host WHERE host = ?", host)) !==
        undefined
      );
    },
  });
  let providers: BuiltInProvider[];
  try {
    providers = builtInProviders(config.identityProviders ?? [], {
      apiOrigin: config.apiOrigin,
      env: options.env,
      log,
    });
  } catch (error) {
    operator?.stop();
    await data.close();
    throw error;
  }
  // The server's own pages (D171): the API origin's, with the appearance switch its own cookie
  // keeps, and the hosted hosts', which keep no cookie (D165 item 8).
  let apiPages: ServerPages;
  let hostedPages: ServerPages;
  try {
    apiPages = serverPages(config.appearance, { appearanceAction: APPEARANCE_PATH });
    hostedPages = serverPages(config.appearance);
  } catch (error) {
    operator?.stop();
    await data.close();
    throw new RpcError(
      createDiagnostic("MOSTRA_REMOTE_CONFIG_INVALID", {
        message: `The configuration key \`appearance.logo\` can't be used: ${(error as Error).message}`,
      }),
    );
  }
  pagesOfHosts = hostedPages;
  const authorize = createAuthorize({
    server: apiPages,
    pages: createApiPages(apiPages, apiPages.name),
    apiOrigin: config.apiOrigin,
    directory: data.directory,
    auth,
    clients: oauthClients,
    operator,
    providers,
    ownerName: (homeId) => ownerOf(homeId).name,
    log,
  });
  authorizer = authorize;
  const mcp = createRemoteMcp({
    apiOrigin: config.apiOrigin,
    version: options.runtimeVersion,
    docs: serverDocs(),
    log,
    operator,
    meter,
    home: async (id) => (await data.home(id)).assembled,
    ensureHome: (accountId) => (auth as Authorization).ensureHome(accountId),
  });
  api = createApi({
    server: apiPages,
    config,
    auth,
    mcp,
    authorize,
    clients: oauthClients,
    registrations: { addresses: clients, rates },
    operator,
    log,
    filesDir: join(options.data, "files"),
    home: async (id) => (await data.home(id)).assembled,
    touch: (id) => data.touch(id),
    suspended: (id) => suspendedHome(id),
    message: (id) => meter?.add("relay.messages", { account: ownerOf(id).account, home: id }),
    stored: (id, bytes) =>
      meter?.add("bytes.stored", { account: ownerOf(id).account, home: id }, bytes),
    ...(Number(options.env["MOSTRA_TEST_GRANT_RECHECK_MS"]) > 0
      ? { recheckMs: Number(options.env["MOSTRA_TEST_GRANT_RECHECK_MS"]) }
      : {}),
  });
  const served: Api = api;
  const apiHost = new URL(config.apiOrigin).host;
  const domains = [config.domains.active, ...(config.domains.spares ?? [])];

  const onRequest = (request: IncomingMessage, response: ServerResponse): void => {
    const host = (request.headers.host ?? "").toLowerCase();
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    // Cookies never reach anything on a hosted host (D165 item 8): dropped before routing. Only
    // the API origin's own sign-in pages read the cookies it set itself.
    if (host !== apiHost) delete request.headers.cookie;
    // The files a server's own pages load (D171): the same public files on every host, so even
    // the page for an unknown host is drawn in the server's theme.
    if ((request.method === "GET" || request.method === "HEAD") && path.startsWith(THEME_BASE)) {
      const file = pagesOfHosts.asset(path.slice(THEME_BASE.length));
      if (file) {
        response.writeHead(200, { ...BASE_HEADERS, ...file.headers });
        response.end(request.method === "HEAD" ? undefined : file.body);
        return;
      }
    }
    if (host === apiHost && request.method === "GET" && path === "/health") {
      json(response, 200, { status: "ok", homes: data.open().length });
      return;
    }
    if (perIpRequests) {
      const taken = rates.take(`request-ip:${clients.keyOf(clients.of(request))}`, perIpRequests);
      if (!taken.ok) {
        response.setHeader("retry-after", String(taken.retryAfterS));
        refusal(
          response,
          429,
          createDiagnostic("MOSTRA_REMOTE_RATE_LIMITED", {
            message: "Too many requests from this address; try again shortly.",
          }),
        );
        return;
      }
    }
    if (host === apiHost) {
      served.request(request, response, path).catch((error: unknown) => {
        log.error("server.api_failed", { path, error });
        if (!response.headersSent) {
          refusal(
            response,
            500,
            createDiagnostic("MOSTRA_HOST_INTERNAL_ERROR", {
              message: "The server failed to answer.",
            }),
          );
        } else response.destroy();
      });
      return;
    }
    const hostRefused = (): void =>
      refusal(
        response,
        421,
        createDiagnostic("MOSTRA_HYGIENE_HOST_REFUSED", {
          message: "This server serves no pages at this host.",
        }),
        pagesOfHosts,
      );
    // An empty or malformed Host gets nothing, and is never asked of an operator.
    if (!/^[a-z0-9.-]{1,253}(:\d{1,5})?$/.test(host)) {
      hostRefused();
      return;
    }
    routing
      .destination(host)
      .then(async (destination) => {
        if (destination.kind === "none" || destination.kind === "api") {
          hostRefused();
          return;
        }
        // Every hosted answer keeps its page in an agent cluster of its own and out of indexes
        // (ARCHITECTURE §15.6, D161).
        response.setHeader("origin-agent-cluster", "?1");
        response.setHeader("x-robots-tag", "noindex");
        await hosted(request, response, destination, path);
      })
      .catch((error: unknown) => {
        log.error("server.hosted_failed", { error });
        if (!response.headersSent) {
          refusal(
            response,
            500,
            createDiagnostic("MOSTRA_HOST_INTERNAL_ERROR", {
              message: "The server failed to answer.",
            }),
          );
        } else response.destroy();
      });
  };

  const notServed = (response: ServerResponse): void =>
    refusal(
      response,
      404,
      createDiagnostic("MOSTRA_HYGIENE_NOT_SERVED", { message: "Nothing is served at this path." }),
    );

  /** The shell's own files, the same on every domain's apex. */
  const assets = getRequestListener(
    async (request: Request) =>
      (shellDir === undefined ? undefined : await shellAssetResponse(shellDir, request)) ??
      new Response(
        JSON.stringify(
          createDiagnostic("MOSTRA_HYGIENE_NOT_SERVED", { message: "No shell file at this path." }),
        ),
        {
          status: 404,
          headers: { "content-type": "application/json", "cache-control": "no-store" },
        },
      ),
    { overrideGlobalObjects: false },
  );

  /** Whether the operator suspended a home (`ServerHandle.suspendHome`). */
  const suspendedHome = (homeId: string): boolean =>
    data.directory.read(
      (db) =>
        db.get<{ suspended_at: string | null }>(
          "SELECT suspended_at FROM home WHERE id = ?",
          homeId,
        )?.suspended_at != null,
    );

  /**
   * A home whose pages are served now: a suspended one answers 403 and one being moved 503,
   * each with its diagnostic, and nothing of it is opened for a page (D165 item 9).
   */
  const pagesOf = async (homeId: string, response: ServerResponse) => {
    if (suspendedHome(homeId)) {
      refusal(response, 403, homeUnavailable("suspended"));
      return undefined;
    }
    try {
      const opened = await data.home(homeId);
      // Requests and the bytes they sent count against the home's owner (metering, §18.6): one
      // HTTP/1.1 connection answers one request at a time, so its written bytes are this one's.
      if (meter?.on) {
        const socket = response.socket;
        const before = socket?.bytesWritten ?? 0;
        response.once("finish", () => {
          const account = ownerOf(homeId).account;
          meter?.add("requests", { account, home: homeId });
          meter?.add(
            "bytes.egress",
            { account, home: homeId },
            Math.max(0, (socket?.bytesWritten ?? before) - before),
          );
        });
      }
      return opened;
    } catch (error) {
      if (error instanceof RpcError && error.diagnostic.code === "MOSTRA_REMOTE_HOME_MOVING") {
        response.setHeader("retry-after", "30");
        refusal(response, 503, error.diagnostic);
        return undefined;
      }
      throw error;
    }
  };

  /** A route of the directory: its home and ID, by ID or by label. */
  const routeBy = (column: "id" | "label", value: string) =>
    data.directory.read((db) =>
      db.get<{ id: string; home_id: string }>(
        `SELECT id, home_id FROM artifact_route WHERE ${column} = ? AND removing_json IS NULL`,
        value,
      ),
    );

  /**
   * A hosted request (§18.4): a shell (a configured apex, or an operator's host for one home or
   * one route) serves only `/a/<routeId>` of the routes it may show and the shell's files; a
   * route's label serves that route's frames.
   */
  const hosted = async (
    request: IncomingMessage,
    response: ServerResponse,
    destination: Exclude<Destination, { kind: "none" | "api" }>,
    path: string,
  ): Promise<void> => {
    if (destination.kind === "shell") {
      if (path.startsWith("/_mostra/shell/assets/")) {
        await assets(request, response);
        return;
      }
      // Where a page's sign-in returns (INTERFACES §18.4): the shell's own page, which finishes it
      // for the route that started it. It reads only the fragment and query it was sent.
      if (path === "/_mostra/signin" && (request.method === "GET" || request.method === "HEAD")) {
        if (shellDir === undefined) {
          notServed(response);
          return;
        }
        const html = readFileSync(join(shellDir, "index.html"));
        response.writeHead(200, {
          ...BASE_HEADERS,
          ...documentHeaders({ kind: "shell", origin: "", shellOrigin: "" }, "'none'"),
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(request.method === "HEAD" ? undefined : html);
        return;
      }
      const match = /^\/a\/(rte_[0-9A-HJKMNP-TV-Z]{26})(?:\/|$)/.exec(path);
      const route =
        match?.[1] !== undefined && RouteId.is(match[1]) ? routeBy("id", match[1]) : undefined;
      // An operator's host shows only its own home's routes, or its one route.
      if (
        !route ||
        (destination.homeId !== undefined && route.home_id !== destination.homeId) ||
        (destination.routeId !== undefined && route.id !== destination.routeId)
      ) {
        notServed(response);
        return;
      }
      const home = await pagesOf(route.home_id, response);
      if (!home) return;
      await home.assembled.serve(request, response, {
        kind: "shell",
        domain: destination.host,
        routeId: route.id,
      });
      return;
    }
    const home = await pagesOf(destination.route.homeId, response);
    if (!home) return;
    await home.assembled.serve(request, response, {
      kind: "frame",
      domain: destination.frameDomain,
      routeId: destination.route.id,
    });
  };

  // Up to 1 MiB of headers (D98 item 9): a sibling tenant page can fill the parent domain's cookie
  // jar (180 cookies of 4 KiB, no public-suffix entry, D137), and its cookies, dropped unread here,
  // must never cost another page its session (D165 item 8).
  const listener: Server = createServer({ maxHeaderSize: 1024 * 1024 }, onRequest);
  // Stopping resets its connections, so none stays in TIME_WAIT on the server's port (#132).
  const stopListener = resetOnClose(listener);
  listener.keepAliveTimeout = 305_000;
  listener.headersTimeout = 30_000;
  listener.requestTimeout = 120_000;
  listener.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const host = (request.headers.host ?? "").toLowerCase();
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    if (host === apiHost) {
      served.upgrade(request, socket, head, path);
      return;
    }
    socket.end("HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n");
  });
  const { host, port } = parseListen(options.listen ?? "127.0.0.1:8080");
  try {
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(port, host, () => {
        listener.off("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await data.close();
    throw new RpcError(
      createDiagnostic("MOSTRA_ENV_BIND_FAILED", {
        message: `The server can't listen on ${host}:${port}: ${(error as NodeJS.ErrnoException).code ?? (error as Error).message}.`,
      }),
    );
  }
  const bound = listener.address() as AddressInfo;
  const address = `http://${bound.family === "IPv6" ? `[${bound.address}]` : bound.address}:${bound.port}`;
  log.info("server.listening", { address, apiOrigin: config.apiOrigin, domains: [...domains] });
  let closing: Promise<void> | undefined;
  return {
    address,
    config,
    close() {
      closing ??= (async () => {
        served.close();
        await mcp.close().catch(() => undefined);
        // What the operator hasn't taken yet stays queued in the directory for the next start.
        meter?.stop();
        operator?.stop();
        await stopListener();
        await data.close();
        log.info("server.stopped", {});
      })();
      return closing;
    },
  };
}

/**
 * Gives each `home_file` row recorded before sizes were kept (directory migration 6) the size of
 * its stored file, so `bytes.held` counts it (MT-03); the triggers add it to the home's total. A
 * file that is gone holds nothing on disk, so its row takes 0 and is never read again.
 */
function fillHeldSizes(directory: Ledger, filesDir: string, log: Log): void {
  const rows = directory.read((db) =>
    db.all<{ home_id: string; sha256: string }>(
      "SELECT home_id, sha256 FROM home_file WHERE size IS NULL",
    ),
  );
  if (rows.length === 0) return;
  const sizes = new Map<string, number>();
  let missing = 0;
  for (const row of rows) {
    if (sizes.has(row.sha256)) continue;
    try {
      sizes.set(row.sha256, statSync(join(filesDir, row.sha256)).size);
    } catch {
      sizes.set(row.sha256, 0);
      missing += 1;
    }
  }
  directory.write((db) => {
    for (const row of rows) {
      db.run(
        "UPDATE home_file SET size = ? WHERE home_id = ? AND sha256 = ? AND size IS NULL",
        sizes.get(row.sha256) ?? 0,
        row.home_id,
        row.sha256,
      );
    }
  });
  log.info("server.held_sizes_filled", { files: sizes.size, missing });
}
