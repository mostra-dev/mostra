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
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type ArtifactDetail,
  ArtifactId,
  type ArtifactRef,
  BROWSER_PROTOCOL_REVISIONS,
  type CapabilityLink,
  type CapabilityScope,
  type ControlsPolicy,
  createDiagnostic,
  durationMs,
  type FrameTicket,
  type Refusal,
  RpcError,
  refusal,
  safePath,
  scopeAllows,
  viewRevokeMethod,
  viewRotateMethod,
  viewUrlMethod,
} from "@mostra/protocol";
import type { Actions } from "../actions/index.ts";
import type { Addressing } from "../addressing/index.ts";
import { runtimeRoot } from "../deps/index.ts";
import type { EphemeralBus, Interaction } from "../interaction/index.ts";
import {
  type Ledger,
  type LedgerDb,
  type RequestKey,
  recordedResult,
  recordResult,
  requestKey,
} from "../ledger/index.ts";
import type { Live } from "../live/index.ts";
import type { Environment, Log } from "../log.ts";
import { handler, type MethodHandler } from "../protocol-server/index.ts";
import { type ActionRoutes, actionRoutes } from "./actions.ts";
import { type BrowserRoutes, type BrowserRoutesOptions, browserRoutes } from "./browser.ts";
import {
  type Capabilities,
  type Grant,
  type MintedToken,
  SESSION_MAX_AGE_S,
} from "./capabilities.ts";
import {
  BASE_HEADERS,
  cookieValues,
  documentHeaders,
  isRefusal,
  jsonResponse,
  type ListenerKind,
  readJsonObject,
  refusalResponse,
  sessionCookie,
} from "./http.ts";
import { versionIntegrity } from "./integrity.ts";
import { createListener, type Listener } from "./listener.ts";
import { type ListenerChecks, mount, type RouteContext, type RouteSpec, refuse } from "./routes.ts";
import { fileResponse, findFile } from "./serve.ts";

export { Capabilities, capabilityKey } from "./capabilities.ts";
export { CONTROLS_POLICY_TIMEOUT_MS, controlsPolicy } from "./controls.ts";

/** What the gateway reads about artifacts and versions. */
export interface GatewayArtifacts {
  /** An artifact in full; throws `MOSTRA_ARTIFACT_NOT_FOUND` for an unknown one. */
  get(ref: ArtifactRef): ArtifactDetail;
  /** The directory of a published version (`versions/<id>`). */
  versionDir(versionId: string): string;
  /** What is wrong with a version's stored files, or `undefined` when they match their digest. */
  damage(versionId: string): Promise<string | undefined>;
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
  /** The interaction core the browser protocol's routes hand their work to (WP-06). */
  readonly interaction: Interaction;
  /**
   * The submit channels and trusted controls in force for a new view of an artifact (D108): the
   * `trustedControls` port's answer, the home's `submitChannels`, or both channels.
   */
  readonly controls: (artifact: ArtifactDetail) => Promise<ControlsPolicy>;
  /** Tells hosts with a `trustedControls` port that a trusted control was used (D108). */
  readonly activated: BrowserRoutesOptions["activated"];
  /** The browser-protocol revisions served; `BROWSER_PROTOCOL_REVISIONS` unless a test adds one. */
  readonly revisions?: readonly string[];
  /**
   * Server functions and live data (WP-08): plain calls, action runs and live sources. Absent,
   * their routes answer 501 behind their checks, as before WP-08.
   */
  readonly actions?: Actions;
  readonly live?: Live;
  /** Run and live updates for page streams and polls (WP-08). */
  readonly bus?: EphemeralBus;
  /** Whether a version's worker is parked (WP-08): its frame ticket tells the shell. */
  readonly parked?: (versionId: string) => boolean;
  /**
   * The delivery target the gateway serves pages for (D111): `live` for viewers, `verify` for a
   * verify run's sandbox (D138), whose tickets name it and whose documents get
   * `<meta name="mostra-target" content="verify">` as they are served. The stored build never
   * holds the tag, so what publish promotes is byte-identical to what verify built.
   */
  readonly target?: "live" | "verify";
}

/** The gateway of one instance. */
export interface Gateway {
  /** Binds the shell's port and every leased artifact port (D99). */
  start(): Promise<void>;
  /** The shell's origin. */
  readonly shellOrigin: () => string;
  /** The artifact's default link (D97 item 3), shown again or minted: the publish receipt's URL. */
  defaultLink(artifactId: string): { readonly url: string; readonly tokenId: string };
  /**
   * Mints a link with every scope, for a version only when `version` names its number (D97
   * item 9): what `view/url` mints, for callers inside the instance (a verify run's sandbox).
   */
  link(input: { readonly artifactId: string; readonly version?: number }): string;
  /** The handlers of `view/url`, `view/rotate` and `view/revoke`. */
  methods(): MethodHandler[];
  /** The origins of the artifact listeners that are bound, by artifact ID. */
  artifactOrigins(): ReadonlyMap<string, string>;
  /** Stops every listener. */
  close(): Promise<void>;
}

/** A frame ticket's answer to the shell: the view it opens and its controls (D104, D108). */
type TicketAnswer = FrameTicket;

const NO_STORE = { "cache-control": "no-store" };

/** How recently an artifact must have been viewed for its port to be bound at start (D129). */
const RECENT_VIEW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The browser-protocol routes of INTERFACES §4 (D96): WP-06 serves `fields`, `submit`, `signal`,
 * `events` and `events/poll`; the others answer 501 until their package attaches a handler.
 */
function laterArtifactRoutes(served: BrowserRoutes, acting: ActionRoutes | undefined): RouteSpec[] {
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
      handler: served.fields,
    },
    {
      method: "POST",
      path: "/_mostra/v/:rev/submit",
      intent: "mutation",
      auth: "session",
      scope: () => "submit",
      handler: served.submit,
    },
    {
      method: "POST",
      path: "/_mostra/v/:rev/signal",
      intent: "mutation",
      auth: "session",
      scope: () => "signal",
      handler: served.signal,
    },
    // A function ID may hold `/` (`lib/mail.ts#send`), so the call path takes the rest of the path.
    {
      method: "POST",
      path: "/_mostra/v/:rev/call/:fn{.+}",
      intent: "mutation",
      auth: "session",
      scope: action,
      ...(acting ? { handler: acting.call } : {}),
    },
    {
      method: "POST",
      path: "/_mostra/v/:rev/runs",
      intent: "mutation",
      auth: "session",
      scope: () => "any-action",
      ...(acting ? { handler: acting.runs } : {}),
    },
    // WP-08: read runs and follow them (re-attach), by ID or by function and key.
    {
      method: "POST",
      path: "/_mostra/v/:rev/runs/attach",
      intent: "mutation",
      auth: "session",
      scope: () => "any-action",
      ...(acting ? { handler: acting.attach } : {}),
    },
    {
      method: "POST",
      path: "/_mostra/v/:rev/runs/:run/cancel",
      intent: "mutation",
      auth: "session",
      scope: () => "any-action",
      ...(acting ? { handler: acting.cancel } : {}),
    },
    // WP-08: live sources a page reads and keeps produced; every link may (`view`).
    {
      method: "POST",
      path: "/_mostra/v/:rev/live",
      intent: "mutation",
      auth: "session",
      ...(acting ? { handler: acting.live } : {}),
    },
    { method: "POST", path: "/_mostra/v/:rev/ticket", intent: "mutation", auth: "session" },
    {
      method: "GET",
      path: "/_mostra/v/:rev/events",
      intent: "stream",
      auth: "session",
      handler: served.stream,
    },
    {
      method: "GET",
      path: "/_mostra/v/:rev/events/poll",
      intent: "stream",
      auth: "session",
      handler: served.poll,
    },
  ];
}

/** Creates the gateway; nothing is bound until {@link Gateway.start}. */
export function createGateway(options: GatewayOptions): Gateway {
  const { addressing, capabilities, artifacts, log, interaction } = options;
  const served = browserRoutes({
    interaction,
    capabilities,
    log,
    versionOf: (artifactId, number) => {
      const found = artifacts.get({ artifactId }).versions.find((v) => v.number === number);
      return found ? { id: found.id, number: found.number } : undefined;
    },
    activated: options.activated,
    ...(options.revisions ? { revisions: options.revisions } : {}),
    ...(options.bus ? { bus: options.bus } : {}),
  });
  const acting: ActionRoutes | undefined =
    options.actions && options.live
      ? actionRoutes({
          interaction,
          actions: options.actions,
          live: options.live,
          log,
          revisions: options.revisions ?? BROWSER_PROTOCOL_REVISIONS,
        })
      : undefined;
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
  const integrity = versionIntegrity(artifacts, log);

  /** The answer for a damaged version: a plain page for a navigation, else the diagnostic. */
  const damaged = (number: number | undefined, damage: string, document: boolean): Response =>
    refusalResponse(
      {
        status: 500,
        diagnostic: createDiagnostic("MOSTRA_HOME_INTEGRITY", {
          message: `${number === undefined ? "A version" : `Version ${number}`} of this artifact is damaged: ${damage}.`,
        }),
      },
      { document, frameAncestors: shellOrigin() },
    );

  const link = (token: MintedToken): CapabilityLink => ({
    url: `${shellOrigin()}/a/${token.artifactId}${token.pinnedVersion !== undefined ? `/v/${token.pinnedVersion}` : ""}#t=${token.secret}`,
    tokenId: token.tokenId,
    scopes: token.scopes,
    ...(token.expiresAt !== undefined ? { expiresAt: token.expiresAt } : {}),
    ...(token.viewerId !== undefined ? { viewer: interaction.viewer(token.viewerId) } : {}),
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

  /** What a link allows, as the shell shows it when two links meet. */
  const access = (grant: Grant) => ({
    scopes: grant.scopes,
    ...(grant.expiresAt !== undefined ? { expiresAt: grant.expiresAt } : {}),
    ...(grant.pinnedVersion !== undefined ? { version: grant.pinnedVersion } : {}),
  });

  /** The session's facts, for the shell and the frame alike. */
  const sessionFacts = (artifactId: string, grant: Grant) => {
    const detail = artifacts.get({ artifactId });
    return { artifact: { id: detail.id, title: detail.title }, ...access(grant) };
  };

  const exchange = async (context: RouteContext): Promise<Response> => {
    const artifactId = context.artifactId as string;
    const meta = { method: "POST", path: new URL(context.request.url).pathname, document: false };
    const body = await readJsonObject(context.request);
    if (isRefusal(body)) return refuse(shellChecks, body, meta);
    const grant = capabilities.presentToken(body["token"], artifactId);
    if (isRefusal(grant)) return refuse(shellChecks, grant, meta);
    // A live session from another link is never replaced silently (D98 item 8): a page elsewhere
    // could send the viewer to its own, narrower link and take over their tabs.
    const existing = capabilities.session(
      cookieValues(context.request.headers.get("cookie"), shellChecks.cookieName()),
      shellOrigin(),
      artifactId,
    );
    if (!isRefusal(existing)) {
      if (existing.grant.tokenId === grant.tokenId) {
        return jsonResponse({ csrf: existing.csrf, ...sessionFacts(artifactId, existing.grant) });
      }
      if (body["replace"] !== true) {
        log.info("gateway.session_conflict", { artifactId, origin: shellOrigin() });
        return jsonResponse(
          {
            ...refusal(
              "MOSTRA_HYGIENE_SESSION_CONFLICT",
              "This browser already has this artifact open from another link.",
            ).diagnostic,
            current: access(existing.grant),
            offered: access(grant),
          },
          { status: 409 },
        );
      }
    }
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
    const pinned = session.grant.pinnedVersion;
    // A link that names a version opens that version only (D97 item 9).
    if (pinned !== undefined && asked !== undefined && asked !== pinned) {
      return refuse(
        shellChecks,
        refusal("MOSTRA_HYGIENE_SCOPE_DENIED", `This link opens version ${pinned} only.`),
        meta,
      );
    }
    const detail = artifacts.get({ artifactId });
    const version = versionOf(detail, (asked as number | undefined) ?? pinned);
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
    // A damaged version is never shown (FAILURE_MODEL §3).
    const damage = await integrity.check(version.id);
    if (damage !== undefined) return damaged(version.number, damage, false);
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
      shellSessionId: session.id,
    });
    // One frame load is one view, of exactly this version, by this link's viewer (D104), with
    // the channels and controls in force for it (D108).
    const controls = await options.controls(detail);
    const viewerId = interaction.viewerOf(session.grant.viewerId);
    const viewId = interaction.openView({
      artifactId,
      versionId: version.id,
      viewerId,
      tokenId: session.grant.tokenId,
      controls,
    });
    const answer: TicketAnswer = {
      artifactId,
      viewId,
      src: `${artifactOrigin}/_mostra/enter?ticket=${value}`,
      artifactOrigin,
      version,
      latest,
      policy: detail.policy ?? { policy: "once", scope: "per-artifact" },
      submitChannels: controls.submitChannels,
      // What the shell offers this link: a control its scopes can't use isn't shown (D97).
      controls: (controls.controls ?? ["submit", "choose", "approve"]).filter((control) =>
        control === "submit"
          ? scopeAllows(session.grant.scopes, "submit")
          : control === "choose"
            ? scopeAllows(session.grant.scopes, "review")
            : true,
      ),
      target: options.target ?? "live",
      follow: interaction.following({ artifactId, viewerId }),
      pinned: pinned !== undefined,
      ...(options.parked?.(version.id) ? { serverParked: true as const } : {}),
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
    // The trusted controls, the version banner's sources and follow (WP-07), and review
    // (WP-20), behind the shell's session (D96). The specific routes come before the wildcard.
    {
      method: "POST",
      path: "/a/:artifactId/_mostra/v/:rev/submit",
      intent: "mutation",
      auth: "session",
      scope: () => "submit",
      handler: served.shellSubmit,
    },
    {
      method: "POST",
      path: "/a/:artifactId/_mostra/v/:rev/review/choose",
      intent: "mutation",
      auth: "session",
      scope: () => "review",
      handler: served.choose,
    },
    {
      method: "POST",
      path: "/a/:artifactId/_mostra/v/:rev/follow",
      intent: "mutation",
      auth: "session",
      handler: served.follow,
    },
    {
      method: "GET",
      path: "/a/:artifactId/_mostra/v/:rev/carry",
      intent: "read",
      auth: "session",
      handler: served.carry,
    },
    {
      method: "GET",
      path: "/a/:artifactId/_mostra/v/:rev/events",
      intent: "stream",
      auth: "session",
      handler: served.stream,
    },
    {
      method: "GET",
      path: "/a/:artifactId/_mostra/v/:rev/events/poll",
      intent: "stream",
      auth: "session",
      handler: served.poll,
    },
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
        // The viewer the page acts as, so edits made before its first snapshot are journaled
        // under it (WP-07; Claude review finding 4).
        viewer: interaction.viewer(interaction.viewerOf(session.grant.viewerId)),
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
      const versionId = session.versionId;
      let file = await findFile(root(versionId), path);
      let from = versionId;
      // Content-hashed chunks stay reachable after another tab moved the session on (D98 item 5),
      // from the versions the link may open: a pinned link's own only (D97 item 9).
      if (!file && path.startsWith("/assets/") && session.grant.pinnedVersion === undefined) {
        for (const version of artifacts.get({ artifactId }).versions) {
          if (version.id === versionId) continue;
          file = await findFile(root(version.id), path);
          if (file) {
            from = version.id;
            break;
          }
        }
      }
      // Every file served comes from a version whose stored files match their digest, checked
      // again whenever a file changed since (FAILURE_MODEL §3).
      const checked =
        file ?? (context.document ? await findFile(root(versionId), "/index.html") : undefined);
      if (checked) {
        const damage = await integrity.serve(from, checked);
        if (damage !== undefined) {
          const number = artifacts.get({ artifactId }).versions.find((v) => v.id === from)?.number;
          return damaged(number, damage, context.document);
        }
      }
      if (file && options.target === "verify" && file.path.endsWith(".html")) {
        return verifyDocument(file.path, context.request, {
          ...headers,
          "cache-control": "no-cache",
        });
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
      if (page && options.target === "verify") {
        return verifyDocument(page.path, context.request, {
          ...headers,
          "cache-control": "no-cache",
        });
      }
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
        handler: enter,
      },
      {
        method: "GET",
        path: "/_mostra/session",
        intent: "read",
        auth: "session",
        handler: frameSession,
      },
      ...laterArtifactRoutes(served, acting),
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

  /**
   * Replays a request recorded with the same parameters (H-03), or runs `fn` and records
   * `{ tokenId }` in the same transaction. The same `requestId` with other parameters is
   * `MOSTRA_HOST_REQUEST_ID_REUSED`, never another link.
   */
  const recorded = (
    key: RequestKey | undefined,
    fn: (db: LedgerDb) => MintedToken,
  ): CapabilityLink => {
    const token = options.ledger.write((db) => {
      if (key !== undefined) {
        const row = recordedResult<{ tokenId: string }>(db, key);
        if (row) return { replay: row.tokenId };
      }
      const minted = fn(db);
      // Only the token ID is recorded: the ledger never holds a link's secret (D97 item 2).
      if (key !== undefined) recordResult(db, key, { tokenId: minted.tokenId });
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
      // The ports of artifacts viewed lately are bound now, so their open frames reload after a
      // restart (D62, FAILURE_MODEL §8). Every other lease stays leased and is bound when its next
      // frame ticket is issued, so a home with thousands of artifacts holds no thousand listeners
      // (D129, amending D99); a lease never moves, so links keep their origins.
      const since = new Date(Date.now() - RECENT_VIEW_MS).toISOString();
      const recent = new Set(
        options.ledger.read((db) =>
          db
            .all<{ artifact_id: string }>(
              "SELECT DISTINCT artifact_id FROM view WHERE opened_at >= ?",
              since,
            )
            .map((row) => row.artifact_id),
        ),
      );
      for (const lease of addressing.leases()) {
        if (lease.purpose !== "artifact" || !recent.has(lease.owner)) continue;
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
    link(input) {
      return link(
        capabilities.mint({
          artifactId: input.artifactId,
          ...(input.version !== undefined ? { pinnedVersion: input.version } : {}),
        }),
      ).url;
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
        return recorded(requestKey("view/url", params), (db) =>
          capabilities.mint(
            {
              artifactId: detail.id,
              scopes: params.scopes,
              ttlMs: params.ttl === undefined ? undefined : durationMs(params.ttl),
              pinnedVersion: params.version === undefined ? undefined : version.number,
              viewerId:
                params.viewer === undefined
                  ? undefined
                  : interaction.viewerForSpec(db, params.viewer),
            },
            db,
          ),
        );
      }),
      handler(viewRotateMethod, (params) =>
        recorded(requestKey("view/rotate", params), (db) => {
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

/** The tag that tells the client runtime it runs for `verify` (D111, D138). */
const VERIFY_TARGET_TAG = '<meta name="mostra-target" content="verify" />';

/**
 * A version's HTML document as a verify run's sandbox serves it: the stored file with the verify
 * target's tag added at the start of its head, so the build itself never carries it (D138).
 */
async function verifyDocument(
  path: string,
  request: Request,
  headers: Record<string, string>,
): Promise<Response> {
  const text = await readFile(path, "utf8");
  const head = /<head[^>]*>/i.exec(text);
  const at = head ? head.index + head[0].length : 0;
  const body = `${text.slice(0, at)}\n    ${VERIFY_TARGET_TAG}\n${text.slice(at)}`;
  return new Response(request.method === "HEAD" ? null : body, {
    headers: { ...BASE_HEADERS, ...headers, "content-type": "text/html; charset=utf-8" },
  });
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
