/**
 * The gateway (ARCHITECTURE §5, §10; D38, D96 to D99, D158): the HTTP side of an instance. It
 * serves the shell on the shell's leased port and each opened artifact on its own leased port, all
 * on one host, so the shell and every artifact are same-site but different origins. Only
 * capability holders get in: a link's token becomes a shell session, the shell hands the
 * artifact's frame a single-use ticket, and the frame's session lets it load its version's files.
 * Every request goes through the same checks (`routes.ts`), and published versions are served
 * straight from disk, with no process (RT-05). It also serves `view/url`, `view/rotate` and
 * `view/revoke`.
 *
 * Beside those loopback listeners, the gateway has **faces** (D158 item 1): external addresses of
 * the shell or one artifact (a tailnet, Funnel or Cloudflare address a share set up, or a host's
 * external base), each its own listener on loopback with one origin and one exact `Host`. Which
 * face a request came through is the socket it arrived on, so a tunnel's visitor can't claim
 * another address. A face pairs with the faces of its group (a share's, a host's): its shell opens
 * frames on the group's artifact face, in cookie mode when both are one site and in worker mode
 * (D70) when they are two.
 *
 * ```ts
 * const gateway = createGateway({ ledger, log, addressing, capabilities, artifacts, shellDir });
 * await gateway.start();
 * const { url } = await gateway.defaultLink(artifactId); // the publish receipt's URL
 * const face = await gateway.openFace({ by: "cloudflare", group, listener: "shell", … });
 * ```
 */
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { join, resolve } from "node:path";
import type { Duplex } from "node:stream";
import {
  type ArtifactDetail,
  ArtifactId,
  type ArtifactRef,
  BROWSER_PROTOCOL_REVISIONS,
  type CapabilityLink,
  type CapabilityScope,
  type ControlsPolicy,
  createDiagnostic,
  type Diagnostic,
  durationMs,
  EnterRequest,
  type FaceStatus,
  FRAME_SESSION_HEADER,
  type FrameSessionFacts,
  type FrameTicket,
  type IdentityVia,
  type PortAddressingExternalBaseResult,
  type Refusal,
  RpcError,
  refusal,
  StreamTicketRequest,
  safePath,
  scopeAllows,
  viewDefaultMethod,
  viewLaunchMethod,
  viewRevokeMethod,
  viewRotateMethod,
  viewUrlMethod,
} from "@mostra/protocol";
import type { Actions } from "../actions/index.ts";
import { type Addressing, type FrameMode, hostOf } from "../addressing/index.ts";
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
import { type DevUpstream, devFetch, devUpgrade } from "./dev.ts";
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
import { type IdentityOutcome, tailnetPerson } from "./identity.ts";
import { versionIntegrity } from "./integrity.ts";
import { createListener, type Listener } from "./listener.ts";
import { type ListenerChecks, mount, type RouteContext, type RouteSpec, refuse } from "./routes.ts";
import { fileResponse, findFile } from "./serve.ts";
import { BOOTSTRAP_PAGE, SERVICE_WORKER_PATH, SERVICE_WORKER_SOURCE } from "./worker.ts";

export { Capabilities, capabilityKey } from "./capabilities.ts";
export { CONTROLS_POLICY_TIMEOUT_MS, controlsPolicy } from "./controls.ts";
export type { DevUpstream } from "./dev.ts";
export {
  decodeEncodedWords,
  IDENTITY_TIMEOUT_MS,
  isLoopbackPeer,
  resolveIdentity,
  tailnetPerson,
} from "./identity.ts";

/** What the gateway reads about artifacts and versions. */
export interface GatewayArtifacts {
  /** An artifact in full; throws `MOSTRA_ARTIFACT_NOT_FOUND` for an unknown one. */
  get(ref: ArtifactRef): ArtifactDetail;
  /** The directory of a published version (`versions/<id>`). */
  versionDir(versionId: string): string;
  /** What is wrong with a version's stored files, or `undefined` when they match their digest. */
  damage(versionId: string): Promise<string | undefined>;
}

/** Who keeps a face (D158 item 1): a share's tunnel, or a host's addressing port. */
export type FaceBy = "tailnet" | "funnel" | "cloudflare" | "host";

/** What a share asks the gateway to open: one external address of the shell or an artifact. */
export interface FaceSpec {
  readonly by: FaceBy;
  /**
   * The faces that pair: a shell face opens frames on the artifact faces of its group (`tailnet`,
   * `funnel`, a Cloudflare share's own, a host's per artifact).
   */
  readonly group: string;
  readonly listener: "shell" | "artifact";
  /** The artifact, for an artifact's face. */
  readonly artifactId?: string;
  /** How requests through it reach the gateway, as the identity port hears it (D143 item 2). */
  readonly via: IdentityVia;
  /** Keep a leased loopback port, so the face's address survives restarts. */
  readonly lease: boolean;
  /** Whether event streams pass; `false` behind a Cloudflare quick tunnel. Default `true`. */
  readonly streams?: boolean;
  /** An artifact face's frame mode, when its keeper knows it; else decided by the pair (D70). */
  readonly mode?: FrameMode;
}

/** An open face. */
export interface FaceHandle {
  /** Its key: `<group>:shell` or `<group>:<artifactId>`. */
  readonly key: string;
  /** The loopback port the tunnel forwards to. */
  readonly port: number;
  /** `http://127.0.0.1:<port>`. */
  readonly local: string;
  /** The origin browsers use; until it is set, the face refuses every request (421). */
  origin(): string | undefined;
  /** Sets the origin once the tunnel knows its address; `undefined` closes the address again. */
  setOrigin(origin: string | undefined): void;
}

/** The answer a host's addressing port gave, or why there is none. */
export type ExternalBaseAnswer =
  | { readonly kind: "base"; readonly base: NonNullable<PortAddressingExternalBaseResult> }
  | { readonly kind: "none" }
  | { readonly kind: "failed" }
  | { readonly kind: "away" };

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
  /**
   * Who a browser is that exchanges a link minted without a viewer (D143 item 2): the person a
   * host's identity port names, the standalone default, or a refusal. Absent: the default.
   */
  readonly identity?: (input: {
    readonly artifactId: string;
    readonly via: IdentityVia;
    readonly headers: Headers;
  }) => Promise<IdentityOutcome>;
  /**
   * Asks the host that registered the `addressing` port for a listener's external origin (HO-10,
   * D158 item 6). Absent: no host addresses, links stay on loopback.
   */
  readonly externalBase?: {
    /** Whether a connected host registered the port now: none asks nothing and opens no face. */
    readonly registered: () => boolean;
    readonly ask: (input: {
      readonly artifactId: string;
      readonly listener: "shell" | "artifact";
      readonly local: string;
    }) => Promise<ExternalBaseAnswer>;
  };
  /**
   * Logs every connection and request of every listener (`MOSTRA_TEST_REQUEST_LOG`, #66): tests
   * only, so a request a browser saw go unanswered shows whether it reached the gateway.
   */
  readonly traceRequests?: boolean;
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
  /**
   * `mostra dev`'s sandbox (D140 item 12): the artifact origin's files and its HMR WebSocket come
   * from the session's Vite server, behind the same checks, and frame tickets say the page is a
   * development preview. `upstream` is where that server listens now.
   */
  readonly dev?: { readonly upstream: () => DevUpstream | undefined };
}

/** The gateway of one instance. */
export interface Gateway {
  /** Binds the shell's port, recently viewed artifacts' ports and the hosts' kept faces (D99). */
  start(): Promise<void>;
  /** The loopback shell's origin. */
  readonly shellOrigin: () => string;
  /**
   * The artifact's default link (D97 item 3), shown again or minted: the publish receipt's URL. A
   * host's external base (D158 item 6), when it gives one, is the link's address.
   */
  defaultLink(artifactId: string): Promise<{ readonly url: string; readonly tokenId: string }>;
  /**
   * Mints a link with every scope, for a version only when `version` names its number (D97
   * item 9): what `view/url` mints, for callers inside the instance (a verify run's sandbox).
   */
  link(input: { readonly artifactId: string; readonly version?: number }): string;
  /**
   * Mints a link at a face's shell address (a share's, D158 item 3), in the caller's transaction
   * when it passes one.
   */
  mintAt(
    input: {
      readonly artifactId: string;
      readonly shellOrigin: string;
      readonly scopes?: readonly CapabilityScope[] | undefined;
      readonly ttlMs?: number | undefined;
      readonly viewerId?: string | undefined;
    },
    within?: LedgerDb,
  ): CapabilityLink;
  /** A link minted before, shown again from its derived secret; `undefined` once it can't be. */
  reveal(tokenId: string): string | undefined;
  /** Opens a face (D158 item 1): its listener on loopback, refusing everything until its origin is set. */
  openFace(spec: FaceSpec): Promise<FaceHandle>;
  /** The face with this key, if it is open. */
  face(key: string): FaceHandle | undefined;
  /** Closes a face's listener; its leased port is released when `release` is set. */
  closeFace(key: string, release?: boolean): Promise<void>;
  /** The open faces, for `instance/status`. */
  faces(): readonly FaceStatus[];
  /** Whether a shell is served at this origin now: launch tickets are minted only for those. */
  servesShell(origin: string): boolean;
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

/** How long a host's answer for an artifact's frame address is reused (D158 item 6). */
const EXTERNAL_BASE_REUSE_MS = 30_000;

/** The key of a face: `<group>:shell`, or `<group>:<artifactId>` for an artifact's. */
export function faceKey(
  group: string,
  listener: "shell" | "artifact",
  artifactId?: string,
): string {
  return `${group}:${listener === "shell" ? "shell" : (artifactId ?? "")}`;
}

/**
 * One way into the gateway, for the routes it serves: the loopback shell or an artifact's
 * listener, or a face. Everything a route needs to know about where a request came in.
 */
interface Way {
  readonly listener: "shell" | "artifact";
  /** `loopback` for the gateway's own listeners. */
  readonly by: FaceBy | "loopback";
  readonly via: IdentityVia;
  readonly artifactId: string | undefined;
  port(): number;
  /** The origin browsers use; `undefined` while a face waits for its tunnel. */
  origin(): string | undefined;
  /** The exact `Host` values accepted. */
  hosts(): readonly string[];
  streams(): boolean;
}

/**
 * The browser-protocol routes of INTERFACES §4 (D96): WP-06 serves `fields`, `submit`, `signal`,
 * `events` and `events/poll`; WP-08 the calls, runs and live sources; WP-13 the stream tickets.
 */
function laterArtifactRoutes(
  served: BrowserRoutes,
  acting: ActionRoutes | undefined,
  ticket: (context: RouteContext) => Promise<Response>,
): RouteSpec[] {
  const action = (params: Readonly<Record<string, string>>): CapabilityScope | "any-action" => {
    const id = params["fn"];
    return id ? (`action:${id}` as CapabilityScope) : "any-action";
  };
  return [
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
    // WP-13: single-use tickets for streams, polls and WebSockets that bypass the worker (D70).
    {
      method: "POST",
      path: "/_mostra/v/:rev/ticket",
      intent: "mutation",
      auth: "session",
      handler: ticket,
    },
    {
      method: "GET",
      path: "/_mostra/v/:rev/events",
      intent: "stream",
      auth: "session",
      sse: true,
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

/** A face as the gateway keeps it. */
interface FaceEntry {
  readonly key: string;
  readonly spec: FaceSpec;
  readonly listener: Listener;
  readonly port: number;
  origin: string | undefined;
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
      return found
        ? {
            id: found.id,
            number: found.number,
            ...(found.collected !== undefined ? { collected: found.collected } : {}),
          }
        : undefined;
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
  const faces = new Map<string, FaceEntry>();
  const openingFaces = new Map<string, Promise<FaceEntry>>();
  /** A host's recent answers for artifacts' frame addresses, by face key (D158 item 6). */
  const askedRecently = new Map<string, number>();
  const integrity = versionIntegrity(artifacts, log);

  // ── Ways in: the loopback listeners and the faces ───────────────────────────────────────

  const loopbackShell: Way = {
    listener: "shell",
    by: "loopback",
    via: "local",
    artifactId: undefined,
    port: () => shellPort ?? 0,
    origin: () => shellOrigin(),
    hosts: () => addressing.hosts(shellPort ?? 0),
    streams: () => true,
  };

  const loopbackArtifact = (artifactId: string, port: () => number): Way => ({
    listener: "artifact",
    by: "loopback",
    via: "local",
    artifactId,
    port,
    origin: () => addressing.origin(port()),
    hosts: () => addressing.hosts(port()),
    streams: () => true,
  });

  const faceWay = (entry: FaceEntry): Way => ({
    listener: entry.spec.listener,
    by: entry.spec.by,
    via: entry.spec.via,
    artifactId: entry.spec.artifactId,
    port: () => entry.port,
    origin: () => entry.origin,
    hosts: () => (entry.origin === undefined ? [] : [hostOf(entry.origin)]),
    streams: () => entry.spec.streams !== false,
  });

  /** The shell of a way's group: the loopback shell, or the group's shell face. */
  const shellOf = (way: Way, group: string | undefined): Way | undefined => {
    if (way.by === "loopback" || group === undefined) return loopbackShell;
    const entry = faces.get(faceKey(group, "shell"));
    return entry ? faceWay(entry) : undefined;
  };

  /** How an artifact way's frames authenticate: by the pair, unless its keeper said (D70). */
  const modeOf = (artifact: Way, group: string | undefined): FrameMode => {
    if (artifact.by === "loopback" || group === undefined) return "cookie";
    const entry = faces.get(faceKey(group, "artifact", artifact.artifactId));
    if (entry?.spec.mode) return entry.spec.mode;
    const shell = shellOf(artifact, group)?.origin();
    const own = artifact.origin();
    return shell !== undefined && own !== undefined ? addressing.frameMode(shell, own) : "worker";
  };

  /** Whether an origin is `https:`, where every cookie is `Secure`. */
  const secure = (origin: string | undefined): boolean => origin?.startsWith("https:") === true;

  /** Whether the gateway serves a shell at this origin now: launch tickets go only there. */
  const servesShell = (origin: string): boolean =>
    origin === shellOrigin() ||
    [...faces.values()].some((entry) => entry.spec.listener === "shell" && entry.origin === origin);

  /** The answer for a damaged version: a plain page for a navigation, else the diagnostic. */
  const damaged = (
    number: number | undefined,
    damage: string,
    document: boolean,
    frameAncestors: string,
  ): Response =>
    refusalResponse(
      {
        status: 500,
        diagnostic: createDiagnostic("MOSTRA_HOME_INTEGRITY", {
          message: `${number === undefined ? "A version" : `Version ${number}`} of this artifact is damaged: ${damage}.`,
        }),
      },
      { document, frameAncestors },
    );

  const link = (token: MintedToken): CapabilityLink => ({
    url: `${token.shellOrigin}/a/${token.artifactId}${token.pinnedVersion !== undefined ? `/v/${token.pinnedVersion}` : ""}#t=${token.secret}`,
    tokenId: token.tokenId,
    scopes: token.scopes,
    ...(token.expiresAt !== undefined ? { expiresAt: token.expiresAt } : {}),
    ...(token.viewerId !== undefined ? { viewer: interaction.viewer(token.viewerId) } : {}),
  });

  /** The version a request names (number or ID), or the latest; `undefined` when there is none. */
  const versionOf = (
    detail: ArtifactDetail,
    wanted: number | string | undefined,
  ): { readonly id: string; readonly number: number; readonly collected?: string } | undefined => {
    const found =
      wanted === undefined
        ? (detail.latestVersion ?? detail.versions[0])
        : detail.versions.find((version) =>
            typeof wanted === "number" ? version.number === wanted : version.id === wanted,
          );
    return found
      ? {
          id: found.id,
          number: found.number,
          ...(found.collected !== undefined ? { collected: found.collected } : {}),
        }
      : undefined;
  };

  // ── Faces (D158 item 1) ─────────────────────────────────────────────────────────────────

  const openFace = (spec: FaceSpec, origin?: string): Promise<FaceEntry> => {
    const key = faceKey(spec.group, spec.listener, spec.artifactId);
    const open = faces.get(key);
    if (open) return Promise.resolve(open);
    const pending = openingFaces.get(key);
    if (pending) return pending;
    const started = (async () => {
      let entry: FaceEntry | undefined;
      const way = (): Way =>
        entry
          ? faceWay(entry)
          : {
              ...loopbackShell,
              origin: () => undefined,
              hosts: () => [],
            };
      const listener = createListener({
        policy: () => ({ origin: entry?.origin ?? "", hosts: way().hosts() }),
        log,
        frameAncestors: () =>
          spec.listener === "shell" ? "'none'" : (shellOf(way(), spec.group)?.origin() ?? "'none'"),
        configure: (app) => {
          if (spec.listener === "shell") mount(app, shellChecks(way), shellRoutes(way, spec.group));
          else {
            const artifactId = spec.artifactId as string;
            mount(
              app,
              artifactChecks(artifactId, way, spec.group),
              artifactRoutes(artifactId, way, spec.group),
            );
          }
        },
        ...(spec.listener === "artifact"
          ? { upgrade: socketUpgrade(spec.artifactId as string, way, spec.group) }
          : {}),
        ...(options.traceRequests ? { traceRequests: true } : {}),
      });
      const port = await addressing.listenFace(listener.server, { key, lease: spec.lease });
      entry = { key, spec, listener, port, origin };
      faces.set(key, entry);
      log.info("gateway.face_open", {
        key,
        by: spec.by,
        local: addressing.faceLocal(port),
        ...(origin !== undefined ? { origin } : {}),
      });
      return entry;
    })().finally(() => openingFaces.delete(key));
    openingFaces.set(key, started);
    return started;
  };

  const handleOf = (entry: FaceEntry): FaceHandle => ({
    key: entry.key,
    port: entry.port,
    local: addressing.faceLocal(entry.port),
    origin: () => entry.origin,
    setOrigin: (origin) => {
      if (entry.origin !== origin) {
        log.info("gateway.face_address", {
          key: entry.key,
          ...(origin !== undefined ? { origin } : {}),
        });
      }
      entry.origin = origin;
    },
  });

  const closeFace = async (key: string, release = false): Promise<void> => {
    const pending = openingFaces.get(key);
    if (pending) await pending.catch(() => undefined);
    const entry = faces.get(key);
    if (entry) {
      faces.delete(key);
      await entry.listener.close();
      log.info("gateway.face_closed", { key });
    }
    if (release) addressing.releaseFace(key);
  };

  // ── A host's external bases (HO-10, D158 item 6) ────────────────────────────────────────

  /** The kept external bases, so a restart serves their links before the host answers again. */
  const keptBases = (): {
    key: string;
    listener: "shell" | "artifact";
    artifact_id: string | null;
    origin: string;
    mode: FrameMode | null;
  }[] =>
    options.ledger.read((db) =>
      db.all<{
        key: string;
        listener: "shell" | "artifact";
        artifact_id: string | null;
        origin: string;
        mode: FrameMode | null;
      }>("SELECT key, listener, artifact_id, origin, mode FROM external_base"),
    );

  const hostSpec = (
    artifactId: string,
    listener: "shell" | "artifact",
    mode?: FrameMode,
  ): FaceSpec => ({
    by: "host",
    group: `host:${artifactId}`,
    listener,
    artifactId,
    via: "token",
    lease: true,
    ...(mode ? { mode } : {}),
  });

  /**
   * The host's face of one of an artifact's listeners, asked again now: the address it gives
   * (kept, so its links work after a restart), or none. `null`, or another origin, withdraws the
   * face given before, whose links stop working; a host that fails or is away keeps what it gave.
   */
  const hostFace = async (
    artifactId: string,
    listener: "shell" | "artifact",
  ): Promise<FaceEntry | undefined> => {
    const port = options.externalBase;
    const group = `host:${artifactId}`;
    const key = faceKey(group, listener, artifactId);
    const kept = faces.get(key);
    // Without a host to ask, a face a host gave before (kept across a restart) still serves.
    if (!port?.registered()) return kept?.origin !== undefined ? kept : undefined;
    if (
      listener === "artifact" &&
      kept &&
      Date.now() - (askedRecently.get(key) ?? 0) < EXTERNAL_BASE_REUSE_MS
    ) {
      return kept;
    }
    // The face listens first, on its leased port, so the host is told where to forward.
    const entry = kept ?? (await openFace(hostSpec(artifactId, listener)));
    const answer = await port.ask({
      artifactId,
      listener,
      local: addressing.faceLocal(entry.port),
    });
    if (answer.kind === "failed" || answer.kind === "away") {
      if (kept?.origin !== undefined) return kept;
      if (!kept) await closeFace(key, true);
      return undefined;
    }
    if (answer.kind === "none") {
      options.ledger.write((db) => db.run("DELETE FROM external_base WHERE key = ?", key));
      await closeFace(key, true);
      return undefined;
    }
    const origin = answer.base.origin;
    const mode = answer.base.mode;
    if (entry.origin !== origin || (entry.spec.mode ?? null) !== (mode ?? null)) {
      // Another origin withdraws the one before: its Host is no longer served.
      if (entry.origin !== undefined || (entry.spec.mode ?? null) !== (mode ?? null)) {
        await closeFace(key);
      }
      const fresh =
        faces.get(key) ?? (await openFace(hostSpec(artifactId, listener, mode), origin));
      fresh.origin = origin;
      options.ledger.write((db) =>
        db.run(
          "INSERT INTO external_base (key, listener, artifact_id, origin, mode, client, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET origin = excluded.origin, mode = excluded.mode, updated_at = excluded.updated_at",
          key,
          listener,
          artifactId,
          origin,
          mode ?? null,
          "host",
          new Date().toISOString(),
        ),
      );
      askedRecently.set(key, Date.now());
      return fresh;
    }
    askedRecently.set(key, Date.now());
    return entry;
  };

  /** Where an artifact's links point: a host's external base when it gives one, else loopback. */
  const linkBase = async (artifactId: string): Promise<string> => {
    const face = await hostFace(artifactId, "shell");
    return face?.origin ?? shellOrigin();
  };

  /** The artifact way a shell way opens frames on, or why there is none. */
  const artifactWayFor = async (
    shell: Way,
    group: string | undefined,
    artifactId: string,
  ): Promise<{ readonly way: Way; readonly group: string | undefined } | Refusal> => {
    if (shell.by === "loopback" || group === undefined) {
      const port = await openArtifact(artifactId);
      return { way: loopbackArtifact(artifactId, () => port), group: undefined };
    }
    if (shell.by === "host") {
      const entry = await hostFace(artifactId, "artifact");
      if (entry?.origin === undefined) {
        return refusal(
          "MOSTRA_HYGIENE_NOT_SERVED",
          "The host gives this artifact's frame no address here.",
          503,
        );
      }
      return { way: faceWay(entry), group };
    }
    const entry = faces.get(faceKey(group, "artifact", artifactId));
    if (entry?.origin === undefined) {
      return refusal("MOSTRA_HYGIENE_NOT_SERVED", "This artifact isn't shared at this address.");
    }
    return { way: faceWay(entry), group };
  };

  // ── The shell ────────────────────────────────────────────────────────────────────────────

  const shellKind = (way: Way): ListenerKind => ({
    kind: "shell",
    origin: way.origin() ?? "",
    shellOrigin: way.origin() ?? "",
  });
  const shellChecks = (way: () => Way): ListenerChecks => ({
    policy: () => ({ origin: way().origin() ?? "", hosts: way().hosts() }),
    capabilities,
    log,
    cookieName: () => `mostra-${way().port()}`,
    frameAncestors: () => "'none'",
    artifactOf: (params) => {
      const id = params["artifactId"];
      return id !== undefined && ArtifactId.is(id) ? id : undefined;
    },
  });

  const shellMissing = (): Response =>
    jsonResponse(
      createDiagnostic("MOSTRA_ENV_SHELL_MISSING", {
        message: "This Mostra runtime has no built shell.",
      }),
      { status: 503 },
    );

  /** The exchanges each browser made, by artifact (WP-12; see `exchange`). */
  const madeSessions = new Map<string, { readonly order: number; readonly grant: Grant }>();
  let exchangeOrder = 0;
  const browserKey = (artifactId: string, browser: unknown): string | undefined =>
    typeof browser === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(browser)
      ? `${artifactId}\u0000${browser}`
      : undefined;

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

  const shellRoutes = (wayOf: () => Way, group: string | undefined): RouteSpec[] => {
    const checks = shellChecks(wayOf);

    /** The shell's page: the same for every artifact; it learns everything from its session. */
    const shellPage = async (context: RouteContext): Promise<Response> => {
      if (options.shellDir === undefined) return shellMissing();
      const way = wayOf();
      if (context.artifactId === undefined) {
        return refuse(
          checks,
          refusal("MOSTRA_HYGIENE_NOT_SERVED", "No artifact is named at this path."),
          {
            method: context.request.method,
            path: new URL(context.request.url).pathname,
            document: true,
          },
        );
      }
      // The page may frame only its artifact's origin: on loopback any port of the host, at an
      // external address exactly the artifact's face there.
      let frames = `http://${addressing.urlHost}:*`;
      if (way.by !== "loopback") {
        const found = await artifactWayFor(way, group, context.artifactId).catch(() => undefined);
        frames = found && !isRefusal(found) ? (found.way.origin() ?? "'none'") : "'none'";
      }
      const html = readFileSync(join(options.shellDir, "index.html"));
      return new Response(context.request.method === "HEAD" ? null : html, {
        headers: {
          ...BASE_HEADERS,
          ...documentHeaders(shellKind(way), frames),
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
        return refuse(checks, refusal("MOSTRA_HYGIENE_NOT_SERVED", "No shell file at this path."), {
          method: context.request.method,
          path: url.pathname,
          document: false,
        });
      }
      return fileResponse(file, context.request, {
        ...documentHeaders(shellKind(wayOf()), `http://${addressing.urlHost}:*`),
        "cache-control": "public, max-age=31536000, immutable",
      });
    };

    /**
     * Who the session acts as when the link names nobody and no host did (D143 item 2, D158 item
     * 2): the home's local user on loopback; over a tunnel the tailnet person Tailscale Serve
     * named, else the link's own viewer, never the home's local user.
     */
    const defaultViewer = (way: Way, context: RouteContext, grant: Grant): string | undefined => {
      if (way.via === "local") return undefined;
      if (way.via === "tailnet") {
        const person = tailnetPerson(context.request.headers, context.remote);
        if (person) return interaction.viewerForTailnet(person);
      }
      return interaction.viewerForLink(grant.tokenId, "Shared link");
    };

    const exchange = async (context: RouteContext): Promise<Response> => {
      const way = wayOf();
      const origin = way.origin() ?? "";
      const artifactId = context.artifactId as string;
      const startedAt = exchangeOrder;
      const meta = { method: "POST", path: new URL(context.request.url).pathname, document: false };
      const body = await readJsonObject(context.request);
      if (isRefusal(body)) return refuse(checks, body, meta);
      // A host's address is asked again at every exchange: one it withdrew stops working (D158).
      if (way.by === "host") {
        const still = await hostFace(artifactId, "shell");
        if (still?.origin !== origin) {
          return refuse(
            checks,
            refusal("MOSTRA_HYGIENE_TOKEN_REVOKED", "The host no longer serves this address.", 410),
            meta,
          );
        }
      }
      // A link's token, or a one-time launch ticket from `mostra open` (D140 item 15), which is
      // spent only once it started (or reused) a session.
      const launch = body["token"] === undefined && body["launch"] !== undefined;
      const browser = browserKey(artifactId, body["browser"]);
      let grant = launch
        ? capabilities.presentLaunch(body["launch"], artifactId, false, origin)
        : capabilities.presentToken(body["token"], artifactId, origin);
      if (isRefusal(grant)) return refuse(checks, grant, meta);
      // A live session from another link is never replaced silently (D98 item 8): a page elsewhere
      // could send the viewer to its own, narrower link and take over their tabs.
      const existing = capabilities.session(
        cookieValues(context.request.headers.get("cookie"), checks.cookieName()),
        origin,
        artifactId,
      );
      if (!isRefusal(existing)) {
        if (existing.grant.tokenId === grant.tokenId) {
          if (launch) capabilities.spendLaunch(body["launch"]);
          return jsonResponse({ csrf: existing.csrf, ...sessionFacts(artifactId, existing.grant) });
        }
        if (body["replace"] !== true) {
          log.info("gateway.session_conflict", { artifactId, origin });
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
      // A link without a viewer acts for whoever the host's identity port names (D143 item 2);
      // a host that took identity over and can't answer refuses the link, never a guess.
      let viewerId: string | undefined;
      if (grant.viewerId === undefined) {
        const outcome: IdentityOutcome = options.identity
          ? await options.identity({ artifactId, via: way.via, headers: context.request.headers })
          : { kind: "default" };
        if (outcome.kind === "unavailable") {
          log.warn("gateway.session_refused", { artifactId, code: outcome.diagnostic.code });
          return jsonResponse(outcome.diagnostic, { status: 503 });
        }
        viewerId =
          outcome.kind === "person"
            ? interaction.viewerForHost(outcome.viewer)
            : defaultViewer(way, context, grant);
      }
      // Everything is judged again after the await, in one synchronous step with the session's
      // creation: a link revoked or expired meanwhile gets no session (Opus review of WP-12,
      // finding 3), and a launch ticket is spent here, so it opens one session however many
      // exchanges presented it while the identity port answered (GPT review finding 1).
      const now = launch
        ? capabilities.presentLaunch(body["launch"], artifactId, true, origin)
        : capabilities.presentToken(body["token"], artifactId, origin);
      if (isRefusal(now)) return refuse(checks, now, meta);
      grant = now;
      const made = browser === undefined ? undefined : madeSessions.get(browser);
      if (
        made !== undefined &&
        made.order > startedAt &&
        made.grant.tokenId !== grant.tokenId &&
        body["replace"] !== true
      ) {
        log.info("gateway.session_conflict", { artifactId, origin });
        return jsonResponse(
          {
            ...refusal(
              "MOSTRA_HYGIENE_SESSION_CONFLICT",
              "This browser already has this artifact open from another link.",
            ).diagnostic,
            current: access(made.grant),
            offered: access(grant),
          },
          { status: 409 },
        );
      }
      const session = capabilities.createSession({ tokenId: grant.tokenId, origin, viewerId });
      if (browser !== undefined) {
        exchangeOrder += 1;
        madeSessions.delete(browser);
        madeSessions.set(browser, { order: exchangeOrder, grant });
        if (madeSessions.size > 4096)
          madeSessions.delete(madeSessions.keys().next().value as string);
      }
      log.info("gateway.session_started", { origin, artifactId, tokenId: grant.tokenId });
      return jsonResponse(
        { csrf: session.csrf, ...sessionFacts(artifactId, grant) },
        {
          headers: {
            "set-cookie": sessionCookie(
              checks.cookieName(),
              session.cookie,
              `/a/${artifactId}`,
              SESSION_MAX_AGE_S,
              secure(origin),
            ),
          },
        },
      );
    };

    const readShellSession = (context: RouteContext): Response => {
      const session = context.session;
      if (!session || context.artifactId === undefined)
        throw new Error("session route without a session");
      return jsonResponse({
        csrf: session.csrf,
        ...sessionFacts(context.artifactId, session.grant),
      });
    };

    const ticket = async (context: RouteContext): Promise<Response> => {
      const way = wayOf();
      const session = context.session;
      const artifactId = context.artifactId;
      if (!session || artifactId === undefined) throw new Error("session route without a session");
      const meta = { method: "POST", path: new URL(context.request.url).pathname, document: false };
      const body = await readJsonObject(context.request);
      if (isRefusal(body)) return refuse(checks, body, meta);
      const asked = body["version"];
      if (asked !== undefined && !(Number.isSafeInteger(asked) && (asked as number) >= 1)) {
        return refuse(
          checks,
          refusal("MOSTRA_HYGIENE_REQUEST_MALFORMED", "`version` must be a version number."),
          meta,
        );
      }
      const pinned = session.grant.pinnedVersion;
      // A link that names a version opens that version only (D97 item 9).
      if (pinned !== undefined && asked !== undefined && asked !== pinned) {
        return refuse(
          checks,
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
      // A collected version's files are gone until its source is published again (D140 item 14).
      if (version.collected !== undefined) {
        return jsonResponse(collectedDiagnostic(version.number), { status: 410 });
      }
      // A damaged version is never shown (FAILURE_MODEL §3).
      // A dev preview has no stored build to check: Vite serves the source (D140 item 12).
      const damage = options.dev ? undefined : await integrity.check(version.id);
      if (damage !== undefined) return damaged(version.number, damage, false, "'none'");
      // The frame opens on the artifact's way in this shell's group: its loopback listener, or
      // the artifact's face at this address (D158 item 1), in the mode the pair needs (D70).
      const found = await artifactWayFor(way, group, artifactId);
      if (isRefusal(found)) return refuse(checks, found, meta);
      const artifactOrigin = found.way.origin() as string;
      const mode = modeOf(found.way, found.group);
      const value = capabilities.mintTicket({
        tokenId: session.grant.tokenId,
        artifactId,
        versionId: version.id,
        origin: artifactOrigin,
        shellOrigin: way.origin() ?? "",
        shellSessionId: session.id,
        viewerId: session.viewerId,
      });
      // One frame load is one view, of exactly this version, by this link's viewer (D104), with
      // the channels and controls in force for it (D108).
      const controls = await options.controls(detail);
      const viewerId = interaction.viewerOf(session.viewerId);
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
        // Worker mode takes its ticket in the fragment, which only the bootstrap page reads.
        src:
          mode === "worker"
            ? `${artifactOrigin}/_mostra/enter#t=${value}`
            : `${artifactOrigin}/_mostra/enter?ticket=${value}`,
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
        ...(options.dev ? { devPreview: true as const } : {}),
        ...(mode === "worker" ? { mode: "worker" as const } : {}),
      };
      return jsonResponse(answer);
    };

    return [
      { method: "GET", path: "/a/:artifactId", intent: "read", auth: "none", handler: shellPage },
      { method: "GET", path: "/a/:artifactId/", intent: "read", auth: "none", handler: shellPage },
      {
        method: "GET",
        path: "/a/:artifactId/v/:number{[1-9][0-9]{0,8}}",
        intent: "read",
        auth: "none",
        handler: shellPage,
      },
      {
        method: "GET",
        path: "/_mostra/shell/*",
        intent: "read",
        auth: "none",
        handler: shellAsset,
      },
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
        sse: true,
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
  };

  // ── Artifacts ────────────────────────────────────────────────────────────────────────────

  const artifactChecks = (
    artifactId: string,
    wayOf: () => Way,
    group: string | undefined,
  ): ListenerChecks => ({
    policy: () => ({ origin: wayOf().origin() ?? "", hosts: wayOf().hosts() }),
    capabilities,
    log,
    cookieName: () => `mostra-${wayOf().port()}`,
    frameAncestors: () => shellOf(wayOf(), group)?.origin() ?? "'none'",
    artifactOf: () => artifactId,
    mode: () => modeOf(wayOf(), group),
    streams: () => wayOf().streams(),
  });

  const artifactRoutes = (
    artifactId: string,
    wayOf: () => Way,
    group: string | undefined,
  ): RouteSpec[] => {
    const origin = (): string => wayOf().origin() ?? "";
    const shell = (): string => shellOf(wayOf(), group)?.origin() ?? "";
    const kind = (): ListenerKind => ({
      kind: "artifact",
      origin: origin(),
      shellOrigin: shell(),
    });
    const checks = artifactChecks(artifactId, wayOf, group);
    const mode = (): FrameMode => modeOf(wayOf(), group);
    const notServed = (context: RouteContext, message: string): Response =>
      refuse(checks, refusal("MOSTRA_HYGIENE_NOT_SERVED", message), {
        method: context.request.method,
        path: new URL(context.request.url).pathname,
        document: context.document,
      });

    /**
     * `GET /_mostra/enter`: in cookie mode the frame's entry with its ticket (D98 item 3); in
     * worker mode the bootstrap page, whose ticket is in the fragment (D70).
     */
    const enter = (context: RouteContext): Response => {
      const url = new URL(context.request.url);
      const meta = { method: "GET", path: url.pathname, document: true };
      if (mode() === "worker") {
        if (url.searchParams.has("ticket")) {
          return notServed(context, "A worker-mode frame enters through its bootstrap page.");
        }
        return new Response(context.request.method === "HEAD" ? null : BOOTSTRAP_PAGE, {
          headers: {
            ...BASE_HEADERS,
            ...documentHeaders(kind(), ""),
            ...NO_STORE,
            "content-type": "text/html; charset=utf-8",
          },
        });
      }
      // A frame enters from its shell, which is same-site. A page elsewhere can navigate a hidden
      // frame here with junk tickets; its entries are refused before redeeming, so they never
      // count towards the guessing limit and can't lock real viewers out (D97 item 8).
      if (context.request.headers.get("sec-fetch-site") === "cross-site") {
        return refuse(
          checks,
          refusal("MOSTRA_HYGIENE_ORIGIN_REFUSED", "A frame enters only from its shell."),
          meta,
        );
      }
      const redeemed = capabilities.redeemTicket(url.searchParams.get("ticket"), origin());
      if (isRefusal(redeemed)) return refuse(checks, redeemed, meta);
      if (redeemed.artifactId !== artifactId) {
        return refuse(
          checks,
          refusal("MOSTRA_HYGIENE_TOKEN_INVALID", "The ticket is for another artifact."),
          meta,
        );
      }
      const headers: Record<string, string> = { ...BASE_HEADERS, ...NO_STORE, location: "/" };
      // A frame that has a session from the same link keeps it and switches version (D98 item 5).
      const existing = capabilities.session(
        cookieValues(context.request.headers.get("cookie"), checks.cookieName()),
        origin(),
        artifactId,
      );
      // The frame acts as its shell session's viewer (D143 item 2): a session of the same link
      // for someone else (the identity port named another person) is never reused.
      if (
        !isRefusal(existing) &&
        existing.grant.tokenId === redeemed.tokenId &&
        existing.viewerId === redeemed.viewerId
      ) {
        capabilities.enterVersion(existing.id, redeemed.versionId);
      } else {
        const session = capabilities.createSession({
          tokenId: redeemed.tokenId,
          origin: origin(),
          versionId: redeemed.versionId,
          viewerId: redeemed.viewerId,
        });
        headers["set-cookie"] = sessionCookie(
          checks.cookieName(),
          session.cookie,
          "/",
          SESSION_MAX_AGE_S,
          secure(origin()),
        );
        log.info("gateway.session_started", {
          origin: origin(),
          artifactId,
          tokenId: redeemed.tokenId,
        });
      }
      return new Response(null, { status: 303, headers });
    };

    /**
     * `POST /_mostra/enter` (worker mode, D70): the bootstrap page exchanges the shell's ticket
     * for a frame session whose secret it hands the service worker. A frame that presents the
     * session it kept, from the same link and viewer, keeps it and switches version.
     */
    const enterWorker = async (context: RouteContext): Promise<Response> => {
      const url = new URL(context.request.url);
      const meta = { method: "POST", path: url.pathname, document: false };
      if (mode() !== "worker") {
        return notServed(context, "This frame enters in cookie mode, with `GET /_mostra/enter`.");
      }
      const body = await readJsonObject(context.request);
      if (isRefusal(body)) return refuse(checks, body, meta);
      const parsed = EnterRequest.safeParse(body);
      if (!parsed.success) {
        return refuse(
          checks,
          refusal("MOSTRA_HYGIENE_REQUEST_MALFORMED", "The entry needs the frame's `ticket`."),
          meta,
        );
      }
      const redeemed = capabilities.redeemTicket(parsed.data.ticket, origin());
      if (isRefusal(redeemed)) return refuse(checks, redeemed, meta);
      if (redeemed.artifactId !== artifactId) {
        return refuse(
          checks,
          refusal("MOSTRA_HYGIENE_TOKEN_INVALID", "The ticket is for another artifact."),
          meta,
        );
      }
      const kept = context.request.headers.get(FRAME_SESSION_HEADER);
      const existing =
        kept === null ? undefined : capabilities.session([kept], origin(), artifactId, "worker");
      let secret: string;
      if (
        kept !== null &&
        existing !== undefined &&
        !isRefusal(existing) &&
        existing.grant.tokenId === redeemed.tokenId &&
        existing.viewerId === redeemed.viewerId
      ) {
        capabilities.enterVersion(existing.id, redeemed.versionId);
        secret = kept;
      } else {
        const session = capabilities.createSession({
          tokenId: redeemed.tokenId,
          origin: origin(),
          versionId: redeemed.versionId,
          viewerId: redeemed.viewerId,
          mode: "worker",
        });
        secret = session.cookie;
        log.info("gateway.session_started", {
          origin: origin(),
          artifactId,
          tokenId: redeemed.tokenId,
          mode: "worker",
        });
      }
      return jsonResponse({ session: secret, shellOrigin: redeemed.shellOrigin });
    };

    /** `GET /_mostra/sw.js`: the worker-mode service worker, allowed to control `/` (D70). */
    const serviceWorker = (context: RouteContext): Response => {
      if (mode() !== "worker") {
        return notServed(context, "This frame enters in cookie mode and has no service worker.");
      }
      return new Response(context.request.method === "HEAD" ? null : SERVICE_WORKER_SOURCE, {
        headers: {
          ...BASE_HEADERS,
          "content-type": "text/javascript; charset=utf-8",
          "service-worker-allowed": "/",
          "cache-control": "no-cache",
        },
      });
    };

    /** `POST /_mostra/v/{rev}/ticket`: a single-use ticket for one stream, poll or socket. */
    const streamTicket = async (context: RouteContext): Promise<Response> => {
      const session = context.session;
      if (!session) throw new Error("session route without a session");
      const meta = { method: "POST", path: new URL(context.request.url).pathname, document: false };
      const body = await readJsonObject(context.request);
      if (isRefusal(body)) return refuse(checks, body, meta);
      const parsed = StreamTicketRequest.safeParse(body);
      if (!parsed.success) {
        return refuse(
          checks,
          refusal("MOSTRA_HYGIENE_REQUEST_MALFORMED", "`purpose` is `stream` or `socket`."),
          meta,
        );
      }
      return jsonResponse(
        capabilities.mintStreamTicket({
          sessionId: session.id,
          origin: origin(),
          artifactId,
          purpose: parsed.data.purpose ?? "stream",
        }),
      );
    };

    const frameSession = (context: RouteContext): Response => {
      const session = context.session;
      if (!session) throw new Error("session route without a session");
      const detail = artifacts.get({ artifactId });
      const version = detail.versions.find((entry) => entry.id === session.versionId);
      const facts: FrameSessionFacts = {
        csrf: session.csrf,
        artifactId,
        shellOrigin: shell(),
        scopes: session.grant.scopes,
        // The viewer the page acts as, so edits made before its first snapshot are journaled
        // under it (WP-07; Claude review finding 4).
        viewer: interaction.viewer(interaction.viewerOf(session.viewerId)),
        ...(version ? { version: { id: version.id, number: version.number } } : {}),
        ...(mode() === "worker" ? { mode: "worker" as const } : {}),
        ...(wayOf().streams() ? {} : { streams: false }),
      };
      return jsonResponse(facts);
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
          checks,
          refusal("MOSTRA_HYGIENE_NOT_SERVED", "Nothing is served at this path."),
          meta,
        );
      }
      const headers = { ...documentHeaders(kind(), "") };
      if (options.dev) {
        // A development preview: the session's Vite server answers, never a stored version.
        const upstream = options.dev.upstream();
        if (!upstream) {
          return refuse(
            checks,
            refusal("MOSTRA_HYGIENE_NOT_SERVED", "The dev server isn't running.", 503),
            meta,
          );
        }
        const answered = await devFetch(upstream, context.request, url.pathname + url.search).catch(
          () => undefined,
        );
        if (!answered) {
          return refuse(
            checks,
            refusal("MOSTRA_HYGIENE_NOT_SERVED", "The dev server didn't answer.", 502),
            meta,
          );
        }
        // Statuses that carry no body (a 304 to a revalidation above all, RFC 9110 §15.4.5).
        const bodiless =
          context.request.method === "HEAD" || [204, 205, 304].includes(answered.status);
        return new Response(bodiless ? null : new Uint8Array(answered.body), {
          status: answered.status,
          headers: { ...answered.headers, ...headers, "cache-control": "no-cache" },
        });
      }
      const root = (versionId: string): string => join(artifacts.versionDir(versionId), "client");
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
          return damaged(number, damage, context.document, shell() || "'none'");
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
        checks,
        refusal("MOSTRA_HYGIENE_NOT_SERVED", "This version has no file at this path."),
        meta,
      );
    };

    return [
      { method: "GET", path: "/_mostra/enter", intent: "read", auth: "none", handler: enter },
      {
        method: "POST",
        path: "/_mostra/enter",
        intent: "exchange",
        auth: "none",
        handler: enterWorker,
      },
      {
        method: "GET",
        path: SERVICE_WORKER_PATH,
        intent: "read",
        auth: "none",
        handler: serviceWorker,
      },
      {
        method: "GET",
        path: "/_mostra/session",
        intent: "read",
        auth: "session",
        handler: frameSession,
      },
      ...laterArtifactRoutes(served, acting, streamTicket),
      { method: "GET", path: "/*", intent: "read", auth: "session", handler: files },
    ];
  };

  /**
   * WebSocket upgrades on an artifact's listener, after the listener checked Host, target and
   * Origin: a dev sandbox's HMR socket (D140 item 12), and the browser protocol's sockets
   * (`/_mostra/v/{rev}/term/{session}`), which open with a single-use socket ticket (D158 item 5)
   * and arrive with the terminals (WP-22, WP-23).
   */
  const socketUpgrade =
    (artifactId: string, wayOf: () => Way, group: string | undefined) =>
    (incoming: IncomingMessage, socket: Duplex, head: Buffer): Refusal | undefined => {
      const way = wayOf();
      const url = new URL(incoming.url ?? "/", "http://gateway.invalid");
      if (/^\/_mostra\/v\/[^/]+\/term\/[^/]+$/.test(url.pathname)) {
        const redeemed = capabilities.redeemStreamTicket(
          url.searchParams.get("ticket"),
          way.origin() ?? "",
          artifactId,
          "socket",
        );
        if (isRefusal(redeemed)) return redeemed;
        return refusal(
          "MOSTRA_HYGIENE_NOT_SERVED",
          "Live terminals arrive with a later Mostra release.",
          501,
        );
      }
      if (options.dev && way.by === "loopback" && group === undefined) {
        const upstream = options.dev.upstream();
        if (!upstream)
          return refusal("MOSTRA_HYGIENE_NOT_SERVED", "The dev server isn't running.", 503);
        const cookie = incoming.headers.cookie;
        const session = capabilities.session(
          cookieValues(typeof cookie === "string" ? cookie : null, `mostra-${way.port()}`),
          way.origin() ?? "",
          artifactId,
        );
        if (isRefusal(session)) return session;
        devUpgrade(upstream, incoming, socket, head);
        return undefined;
      }
      return refusal("MOSTRA_HYGIENE_NOT_SERVED", "This gateway serves no WebSocket here.");
    };

  /** Binds the artifact's listener on its leased port, once; resolves with the port. */
  const openArtifact = (artifactId: string): Promise<number> => {
    const bound = artifactListeners.get(artifactId);
    if (bound) return Promise.resolve(bound.port);
    const pending = opening.get(artifactId);
    if (pending) return pending;
    const started = (async () => {
      let port = 0;
      const way = loopbackArtifact(artifactId, () => port);
      const listener = createListener({
        policy: () => ({ origin: addressing.origin(port), hosts: addressing.hosts(port) }),
        log,
        frameAncestors: () => shellOrigin(),
        configure: (app) =>
          mount(
            app,
            artifactChecks(artifactId, () => way, undefined),
            artifactRoutes(artifactId, () => way, undefined),
          ),
        upgrade: socketUpgrade(artifactId, () => way, undefined),
        ...(options.traceRequests ? { traceRequests: true } : {}),
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

  /** Opens the faces a host gave before a restart, so their links work before it answers again. */
  const restoreBases = async (): Promise<void> => {
    for (const row of keptBases()) {
      if (row.artifact_id === null) continue;
      try {
        artifacts.get({ artifactId: row.artifact_id });
      } catch {
        continue;
      }
      try {
        const entry = await openFace(
          hostSpec(row.artifact_id, row.listener, row.mode ?? undefined),
          row.origin,
        );
        entry.origin = row.origin;
      } catch (error) {
        log.warn("gateway.face_restore_failed", { key: row.key, error: (error as Error).message });
      }
    }
  };

  return {
    shellOrigin,
    async start() {
      const pruned = capabilities.prune();
      if (pruned > 0) log.info("gateway.sessions_pruned", { count: pruned });
      shellListener = createListener({
        policy: () => ({ origin: shellOrigin(), hosts: addressing.hosts(shellPort ?? 0) }),
        log,
        frameAncestors: () => "'none'",
        configure: (app) =>
          mount(
            app,
            shellChecks(() => loopbackShell),
            shellRoutes(() => loopbackShell, undefined),
          ),
        ...(options.traceRequests ? { traceRequests: true } : {}),
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
      await restoreBases();
    },
    async defaultLink(artifactId) {
      const base = await linkBase(artifactId);
      const { url, tokenId } = link(capabilities.defaultLink(artifactId, base));
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
    mintAt(input, within) {
      return link(
        capabilities.mint(
          {
            artifactId: input.artifactId,
            scopes: input.scopes,
            ttlMs: input.ttlMs,
            viewerId: input.viewerId,
            shellOrigin: input.shellOrigin,
          },
          within,
        ),
      );
    },
    reveal(tokenId) {
      const shown = capabilities.reveal(tokenId);
      return shown ? link(shown).url : undefined;
    },
    async openFace(spec) {
      return handleOf(await openFace(spec));
    },
    face(key) {
      const entry = faces.get(key);
      return entry ? handleOf(entry) : undefined;
    },
    closeFace,
    faces: () =>
      [...faces.values()]
        .filter((entry) => entry.origin !== undefined)
        .map((entry) => ({
          origin: entry.origin as string,
          local: addressing.faceLocal(entry.port),
          listener: entry.spec.listener,
          ...(entry.spec.artifactId !== undefined ? { artifactId: entry.spec.artifactId } : {}),
          by: entry.spec.by,
        })),
    methods: () => [
      handler(viewUrlMethod, async (params) => {
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
        if (version.collected !== undefined)
          throw new RpcError(collectedDiagnostic(version.number));
        const base = await linkBase(detail.id);
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
              shellOrigin: base,
            },
            db,
          ),
        );
      }),
      handler(viewDefaultMethod, async (params) => {
        const detail = artifacts.get(params.artifact);
        return link(capabilities.defaultLink(detail.id, await linkBase(detail.id)));
      }),
      handler(viewLaunchMethod, (params) => {
        const minted = capabilities.mintLaunch(params.tokenId);
        if (minted === undefined) {
          return fail(
            refusal(
              "MOSTRA_HYGIENE_TOKEN_INVALID",
              `No capability token ${params.tokenId} exists in this home.`,
            ),
          );
        }
        if (minted === "dead") {
          return fail(
            refusal(
              "MOSTRA_HYGIENE_TOKEN_REVOKED",
              `The token ${params.tokenId} was revoked, has expired, or was made for another address.`,
            ),
          );
        }
        const { grant } = minted;
        return {
          url: `${grant.shellOrigin}/a/${grant.artifactId}${grant.pinnedVersion !== undefined ? `/v/${grant.pinnedVersion}` : ""}#l=${minted.ticket}`,
          expiresAt: minted.expiresAt,
        };
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
      await Promise.allSettled([...opening.values(), ...openingFaces.values()]);
      await Promise.all([
        shellListener?.close(),
        ...[...artifactListeners.values()].map((entry) => entry.listener.close()),
        ...[...faces.values()].map((entry) => entry.listener.close()),
      ]);
      faces.clear();
    },
    servesShell,
  };
}

/** The answer for a version `mostra gc` collected (D140 item 14). */
function collectedDiagnostic(number: number): Diagnostic {
  return createDiagnostic("MOSTRA_ARTIFACT_VERSION_COLLECTED", {
    message: `Version ${number} of this artifact was collected by gc; its files are gone until its source is published again.`,
  });
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
