/**
 * A hosted home (ARCHITECTURE §15.2, DATA_MODEL §7.2, D165): a Mostra home on a remote server with
 * the same ledger, registry, interaction core and events as a local one, and no sources, builds,
 * verify, workers, dependency store or secrets. Its versions arrive from the owner instance
 * (`hosted/push`): the client files the listing names, checked against `outputDigest`, never the
 * server files; its server code runs on the owner, through the relay.
 *
 * Its host protocol is served by a {@link ProtocolServer} of its own, reached over the network
 * binding (§18.2), so the owner instance is a host of its hosted home as any host is of an
 * instance (invariant 11): it registers `submissions`, and a submission's one delivery owner is its
 * artifact's owner link (D165, after the Opus review).
 */
import { createHash, randomBytes } from "node:crypto";
import { linkSync, mkdirSync, writeFileSync } from "node:fs";
import { copyFile, readFile, rm } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, join, relative } from "node:path";
import {
  ArtifactManifest,
  artifactGetMethod,
  artifactListMethod,
  createDiagnostic,
  type HostedPushParams,
  type HostedPushResult,
  type HostedRoute,
  hostedPushMethod,
  hostedSubmissionMethod,
  type InstanceInfo,
  RouteId,
  RpcError,
  remoteTokenMethod,
} from "@mostra/protocol";
import type { Addressing } from "../addressing/index.ts";
import { coverageMatcher, readFieldCoverage, readServerFunctions } from "../builder/index.ts";
import { noFaults } from "../faults.ts";
import {
  Capabilities,
  capabilityKey,
  createGateway,
  type FaceSpec,
  type Gateway,
} from "../gateway/index.ts";
import { platformName } from "../home/index.ts";
import { createEphemeralBus, createInteraction, type Interaction } from "../interaction/index.ts";
import type { Ledger } from "../ledger/index.ts";
import { createLive, liveMethods } from "../live/index.ts";
import type { Log } from "../log.ts";
import { handler, ProtocolServer, type Session } from "../protocol-server/index.ts";
import { canonicalRef, listingDigest, versionIdFor } from "../publish/index.ts";
import { openRegistry, type Registry } from "../registry/index.ts";
import type { Authorization } from "./auth.ts";
import { rotateIncarnation } from "./data.ts";
import { createHostedRelay } from "./relay.ts";

/** Lower-case Crockford base32, for route labels (one DNS label, 130 bits). */
const LABEL_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** A random route label: 26 lower-case Crockford base32 characters (INTERFACES §18.4). */

/** A character no part of a listing's path may hold: a backslash, a colon, a control character. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it refuses
const UNSAFE_PART = /[\\:\u0000-\u001f\u007f]/;

/**
 * Whether a pushed listing's path is one a version can hold on every system the server runs on: `/`
 * between non-empty parts, none `.` or `..`, and no backslash, colon or control character, which
 * Windows reads as separators, drive or stream names, or refuses (Opus review of WP-29, 5); in NFC,
 * as listings are written (DATA_MODEL §2).
 */
function safeListingPath(path: string): boolean {
  if (path.length > 1024 || path.normalize("NFC") !== path) return false;
  return path
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== ".." && !UNSAFE_PART.test(part));
}

export function randomLabel(): string {
  const bytes = randomBytes(26);
  let label = "";
  for (const byte of bytes) label += LABEL_ALPHABET[byte & 31];
  return label;
}

/** What the server keeps of one open hosted home. */
export interface HostedHome {
  readonly id: string;
  readonly dir: string;
  readonly ledger: Ledger;
  readonly registry: Registry;
  readonly interaction: Interaction;
  /** The home's host protocol, served over the binding. */
  readonly protocol: ProtocolServer;
  /** The home's current incarnation (DATA_MODEL §7.2). */
  incarnation(): string;
  /** The SHA-256s of client files a pending push of this home names as missing. */
  wanted(sha256: string): boolean;
  /** Records a file this home uploaded (`PUT /files/<sha256>`, §18.2). */
  uploaded(sha256: string): void;
  /** Whether a binding is open, a stream or poll is served, or a delivery waits. */
  busy(): boolean;
  /**
   * Serves a request the server's front routed here by its exact `Host` (INTERFACES §18.4): the
   * shell on a user-content domain's apex (`/a/<routeId>…`), or a route's frames on its label.
   */
  serve(request: IncomingMessage, response: ServerResponse, at: HostedAddress): Promise<void>;
  stop(): Promise<void>;
}

/** Where a hosted request came in: a domain's apex, or a route's label on it. */
export type HostedAddress =
  | { readonly kind: "shell"; readonly domain: string; readonly routeId: string }
  | { readonly kind: "frame"; readonly domain: string; readonly routeId: string };

/** Options for {@link openHostedHome}. */
export interface HostedHomeOptions {
  readonly id: string;
  readonly dir: string;
  readonly ledger: Ledger;
  readonly incarnation: string;
  /** The server's directory ledger (routes, files, links). */
  readonly directory: Ledger;
  /** `<data>/files`: version files, content-addressed, stored once for the directory. */
  readonly filesDir: string;
  readonly auth: Authorization;
  readonly runtimeVersion: string;
  readonly log: Log;
  /** `https` behind a TLS terminator; `http` only for loopback tests (§18.1). */
  readonly scheme: "https" | "http";
  /** The user-content domains: new links on `active`, issued ones keep theirs (D137). */
  readonly domains: { readonly active: string; readonly spares: readonly string[] };
  /** The shell's built files. */
  readonly shellDir: string | undefined;
  /** The relay's server settings (`relay` in the configuration, D165 item 4). */
  readonly relay?: {
    readonly waitingRunsPerArtifact?: number | undefined;
    readonly drainPerSecond?: number | undefined;
    /** How often waiting and unacknowledged runs meet their limits (tests shorten it). */
    readonly sweepMs?: number | undefined;
    /** How often viewers' live interest is renewed with the owner (tests shorten it). */
    readonly liveRenewMs?: number | undefined;
    /** `rateLimits.perLink.relayedRuns`, in milliseconds. */
    readonly perLink?: { readonly count: number; readonly perMs: number } | undefined;
  };
}

function refuse(code: Parameters<typeof createDiagnostic>[0], message: string): RpcError {
  return new RpcError(createDiagnostic(code, { message }));
}

/** Opens the parts of a hosted home over its ledger. */
export async function openHostedHome(options: HostedHomeOptions): Promise<HostedHome> {
  const { id, dir, ledger, directory, log } = options;
  const registry = await openRegistry({ home: dir, ledger });
  /** Pending pushes: version ID → the client files still missing. */
  const pending = new Map<string, Set<string>>();
  let incarnation = options.incarnation;

  const ownerLinkOf = (artifactId: string): string | undefined =>
    directory.read(
      (db) =>
        db.get<{ owner_link_id: string }>(
          "SELECT owner_link_id FROM artifact_route WHERE home_id = ? AND artifact_id = ?",
          id,
          artifactId,
        )?.owner_link_id,
    );

  const coverage = (() => {
    const cache = new Map<string, (fieldId: string) => boolean>();
    return (versionId: string) => {
      let matcher = cache.get(versionId);
      if (!matcher) {
        matcher = coverageMatcher(readFieldCoverage(registry.store.versionDir(versionId)));
        if (cache.size >= 512) cache.delete(cache.keys().next().value as string);
        cache.set(versionId, matcher);
      }
      return matcher;
    };
  })();

  let protocol: ProtocolServer;
  const interaction = createInteraction({
    // A respondent on a hosted link learns only that the answer was sent (D165 item 1a).
    sentOnly: true,
    ledger,
    log,
    faults: noFaults,
    hosts: {
      registrants: (port) => protocol.registrants(port),
      call: (session, method, params, timeoutMs) =>
        protocol.callSession(session, method, params as never, timeoutMs),
      notify: (session, method, params) => protocol.notify(session, method, params as never),
      drained: (session) => protocol.drained(session),
    },
    expectedHosts: () => [],
    artifacts: { resolve: (ref) => registry.get(canonicalRef(ref)).id },
    coverage,
    // A submission's one delivery owner is its artifact's owner link, connected or not, so it
    // waits for that instance and no other instance of the account receives it (D165 item 1b).
    deliverSnapshots: true,
    deliveryOwners: (artifactId) => {
      const owner = ownerLinkOf(artifactId);
      return owner === undefined ? undefined : [owner];
    },
  });

  /** The route of an artifact on this home, minted on its first push by `link`. */
  const routeFor = (artifactId: string, link: string): HostedRoute =>
    directory.write((db) => {
      const found = db.get<{ id: string; label: string; owner_link_id: string }>(
        "SELECT id, label, owner_link_id FROM artifact_route WHERE home_id = ? AND artifact_id = ?",
        id,
        artifactId,
      );
      if (found) {
        if (found.owner_link_id !== link) {
          const owner = db.get<{ name: string }>(
            "SELECT name FROM instance_link WHERE id = ?",
            found.owner_link_id,
          );
          throw refuse(
            "MOSTRA_REMOTE_NOT_OWNER_INSTANCE",
            `The instance "${owner?.name ?? found.owner_link_id}" owns this hosted artifact; push it from there.`,
          );
        }
        return { routeId: found.id, label: found.label };
      }
      const routeId = RouteId.create();
      let label = randomLabel();
      // A label is issued once, forever (label_issued keeps every one): a collision draws again.
      while (db.get("SELECT 1 FROM label_issued WHERE label = ?", label)) label = randomLabel();
      const at = new Date().toISOString();
      db.run(
        "INSERT INTO label_issued (label, home_id, route_id, kind, issued_at) VALUES (?, ?, ?, 'server', ?)",
        label,
        id,
        routeId,
        at,
      );
      db.run(
        "INSERT INTO artifact_route (id, home_id, artifact_id, owner_link_id, label, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        routeId,
        id,
        artifactId,
        link,
        label,
        at,
      );
      log.info("server.route_minted", { home: id, artifactId, routeId });
      return { routeId, label };
    });

  // ── Hosted pages (INTERFACES §18.4) ────────────────────────────────────────────────────

  const routeOf = (artifactId: string): { id: string; label: string } | undefined =>
    directory.read((db) =>
      db.get<{ id: string; label: string }>(
        "SELECT id, label FROM artifact_route WHERE home_id = ? AND artifact_id = ?",
        id,
        artifactId,
      ),
    );
  const artifactOfRoute = (routeId: string): string | undefined =>
    directory.read(
      (db) =>
        db.get<{ artifact_id: string }>(
          "SELECT artifact_id FROM artifact_route WHERE id = ? AND home_id = ?",
          routeId,
          id,
        )?.artifact_id,
    );
  const domains = [options.domains.active, ...options.domains.spares];
  const originOf = (host: string): string => `${options.scheme}://${host}`;
  const capabilities: Capabilities = new Capabilities({
    ledger,
    log,
    key: capabilityKey(dir, log),
    now: () => Date.now(),
    shellOrigin: () => originOf(options.domains.active),
    servesShell: (origin) => domains.some((domain) => originOf(domain) === origin),
  });
  // A hosted home binds nothing: its faces are served through the front. These answer the few
  // questions the gateway asks of loopback addressing, none of which a hosted face reaches.
  const addressing: Addressing = {
    bindAddress: "",
    urlHost: options.domains.active,
    origin: () => originOf(options.domains.active),
    hosts: () => [],
    leased: () => undefined,
    leases: () => [],
    listen: () => Promise.reject(new Error("A hosted home binds no listener.")),
    frameMode: () => "worker",
    listenFace: () => Promise.reject(new Error("A hosted home binds no listener.")),
    releaseFace: () => undefined,
    faceLocal: () => "",
  };
  const bus = createEphemeralBus();
  // Live values a hosted page reads: tallies (counted here, RM-07) and the values its owner's
  // producers push through the relay. No producer runs here: the home runs no artifact code.
  const noPool = new Proxy(
    {},
    {
      get: () => {
        throw new Error("A hosted home runs no workers.");
      },
    },
  ) as Parameters<typeof createLive>[0]["pool"];
  const live = createLive({
    ledger,
    log,
    bus,
    pool: noPool,
    interaction,
    latest: () => undefined,
    artifactsWithLive: () => [],
    version: () => undefined,
  });
  // The relay: a hosted page's runs and calls run on its owner instance (D165 item 4).
  const relay = createHostedRelay({
    ledger,
    interaction,
    bus,
    log,
    ownerOf: (artifactId) => ownerLinkOf(artifactId),
    // The newest session of a link is its own: an older one is a connection the owner already
    // left, which the server may hold until its silence limit (Opus review of WP-29, 1).
    sessionOf: (linkId) =>
      protocol
        .registrants("relay")
        .filter((entry) => entry.owner === linkId)
        .at(-1)?.session,
    call: (session, method, params, timeoutMs) =>
      protocol.callSession(session, method, params, timeoutMs),
    functions: (versionId) => readServerFunctions(registry.store.versionDir(versionId)),
    ...(options.relay?.waitingRunsPerArtifact !== undefined
      ? { waitingRunsPerArtifact: options.relay.waitingRunsPerArtifact }
      : {}),
    ...(options.relay?.drainPerSecond !== undefined
      ? { drainPerSecond: options.relay.drainPerSecond }
      : {}),
    ...(options.relay?.sweepMs !== undefined ? { sweepMs: options.relay.sweepMs } : {}),
    ...(options.relay?.liveRenewMs !== undefined ? { liveRenewMs: options.relay.liveRenewMs } : {}),
    ...(options.relay?.perLink !== undefined ? { perLink: options.relay.perLink } : {}),
    latestVersion: (artifactId) =>
      ledger.read(
        (db) =>
          db.get<{ latest_version_id: string | null }>(
            "SELECT latest_version_id FROM artifact WHERE id = ?",
            artifactId,
          )?.latest_version_id ?? undefined,
      ),
    storeLive: (artifactId, versionId, produced) => live.relayed(artifactId, versionId, produced),
  });
  /** A page's live reads: they ask the owner for producers, and say when it is away. */
  const hostedLive: Pick<typeof live, "read"> = {
    read(page, input) {
      const states = live.read(page, input);
      relay.liveWanted(page.artifactId);
      if (!relay.ownerOffline(page.artifactId)) return states;
      return states.map((state) =>
        state.key.startsWith("$tally/") ? state : { ...state, ownerOffline: true },
      );
    },
  };
  const gateway: Gateway = createGateway({
    ledger,
    log,
    addressing,
    capabilities,
    artifacts: {
      get: (ref) => registry.get(canonicalRef(ref)),
      versionDir: (versionId) => registry.store.versionDir(versionId),
      damage: (versionId) => hostedDamage(registry.store.versionDir(versionId)),
    },
    shellDir: options.shellDir,
    interaction,
    bus,
    actions: relay,
    live: hostedLive,
    // Both channels: a hosted home has no host to narrow them (its owner is a host of it, D165).
    controls: async () => ({ submitChannels: ["shell", "artifact"] }),
    activated: () => undefined,
    hosted: {
      shellOrigin: () => originOf(options.domains.active),
      servesShell: (origin) => domains.some((domain) => originOf(domain) === origin),
      shellPath: (artifactId) => `/a/${routeOf(artifactId)?.id ?? artifactId}`,
      artifactOrigin: (artifactId, shellOrigin) => {
        const route = routeOf(artifactId);
        const domain = domains.find((candidate) => originOf(candidate) === shellOrigin);
        return route && domain ? originOf(`${route.label}.${domain}`) : undefined;
      },
    },
  });
  /** The faces of a domain: its shell, and a route's frames, opened when first asked for. */
  const shellSpec = (domain: string): FaceSpec => ({
    by: "hosted",
    group: `hosted:${domain}`,
    listener: "shell",
    via: "token",
    lease: false,
  });
  const ensureShell = async (domain: string): Promise<string> => {
    const spec = shellSpec(domain);
    const handle = await gateway.openFace(spec);
    handle.setOrigin(originOf(domain));
    return handle.key;
  };
  const ensureFrame = async (
    domain: string,
    artifactId: string,
    label: string,
  ): Promise<string> => {
    await ensureShell(domain);
    const handle = await gateway.openFace({
      by: "hosted",
      group: `hosted:${domain}`,
      listener: "artifact",
      artifactId,
      via: "token",
      lease: false,
      mode: "worker",
    });
    handle.setOrigin(originOf(`${label}.${domain}`));
    return handle.key;
  };
  const notServed = (response: ServerResponse): void => {
    response.writeHead(404, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(
      JSON.stringify(
        createDiagnostic("MOSTRA_HYGIENE_NOT_SERVED", {
          message: "Nothing is served at this path.",
        }),
      ),
    );
  };
  const serve = async (
    request: IncomingMessage,
    response: ServerResponse,
    at: HostedAddress,
  ): Promise<void> => {
    const artifactId = artifactOfRoute(at.routeId);
    const route = artifactId === undefined ? undefined : routeOf(artifactId);
    if (artifactId === undefined || !route) {
      notServed(response);
      return;
    }
    if (at.kind === "shell") {
      // The shell's paths name the route; the gateway's routes name the artifact (§18.4).
      const url = request.url ?? "/";
      const prefix = `/a/${at.routeId}`;
      if (!url.startsWith(prefix)) {
        notServed(response);
        return;
      }
      request.url = `/a/${artifactId}${url.slice(prefix.length)}`;
      const key = await ensureShell(at.domain);
      if (!gateway.dispatch(key, request, response)) notServed(response);
      return;
    }
    const key = await ensureFrame(at.domain, artifactId, route.label);
    if (!gateway.dispatch(key, request, response)) notServed(response);
  };

  /** The client files of a listing this home doesn't hold yet. */
  const missingOf = (files: readonly string[]): string[] =>
    directory.read((db) =>
      files.filter(
        (sha) => !db.get("SELECT 1 FROM home_file WHERE home_id = ? AND sha256 = ?", id, sha),
      ),
    );

  const push = async (params: HostedPushParams, session: Session): Promise<HostedPushResult> => {
    const link = session.link?.instanceId;
    if (link === undefined || session.attributes["linkId"] !== link) {
      throw refuse(
        "MOSTRA_REMOTE_NOT_OWNER_INSTANCE",
        "Only an owner instance's binding pushes versions.",
      );
    }
    const version = params.version;
    // The identity is checked, not believed: the version ID is a digest of the artifact ID and the
    // two digests (D89), and the listing's digest is the output digest (DATA_MODEL §2).
    if (
      versionIdFor(params.artifactId, version.sourceDigest, version.envDigest) !== version.versionId
    ) {
      throw refuse("MOSTRA_HOME_INTEGRITY", "The pushed version's ID doesn't match its digests.");
    }
    const listed = version.listing.map(([path, executable, sha256]) => ({
      path,
      executable,
      sha256,
    }));
    if (listingDigest(listed) !== version.outputDigest) {
      throw refuse("MOSTRA_HOME_INTEGRITY", "The pushed listing doesn't match the output digest.");
    }
    const registryEntry = version.listing.find(([path]) => path === "registry.json");
    if (!registryEntry || sha256Text(version.registry) !== registryEntry[2]) {
      throw refuse(
        "MOSTRA_HOME_INTEGRITY",
        "The pushed registry.json isn't the one the listing names.",
      );
    }
    for (const [path] of version.listing) {
      if (!(path === "registry.json" || path.startsWith("client/") || path.startsWith("server/"))) {
        throw refuse("MOSTRA_HOME_INTEGRITY", `The listing names ${path}, outside a version.`);
      }
      if (!safeListingPath(path)) {
        throw refuse(
          "MOSTRA_HOME_INTEGRITY",
          `The listing names an unsafe path, ${JSON.stringify(path.slice(0, 300))}.`,
        );
      }
    }
    let manifestDoc: { manifest?: unknown; artifactId?: unknown; versionId?: unknown };
    try {
      manifestDoc = JSON.parse(version.manifest) as typeof manifestDoc;
    } catch {
      throw refuse("MOSTRA_HOME_INTEGRITY", "The pushed manifest.json isn't JSON.");
    }
    if (
      manifestDoc.artifactId !== params.artifactId ||
      manifestDoc.versionId !== version.versionId
    ) {
      throw refuse("MOSTRA_HOME_INTEGRITY", "The pushed manifest.json names another version.");
    }
    const manifest = ArtifactManifest.safeParse(manifestDoc.manifest);
    if (!manifest.success)
      throw refuse("MOSTRA_HOME_INTEGRITY", "The pushed artifact manifest isn't valid.");

    const route = routeFor(params.artifactId, link);
    if (registry.hasVersion(version.versionId)) {
      const known = registry
        .get({ artifactId: params.artifactId })
        .versions.find((v) => v.id === version.versionId);
      return {
        status: "complete",
        versionId: version.versionId,
        number: known?.number ?? version.number,
        route,
      };
    }
    // Only client files are stored: server code never reaches the server (D165 item 3).
    const clientFiles = version.listing.filter(([path]) => path.startsWith("client/"));
    const missing = missingOf([...new Set(clientFiles.map(([, , sha]) => sha))]);
    if (missing.length > 0) {
      pending.set(version.versionId, new Set(missing));
      return { status: "missing", files: missing, route };
    }
    pending.delete(version.versionId);

    // Every file is here: lay the version out as the gateway serves versions, then commit it.
    const stage = join(
      registry.store.stagingDir,
      `${version.versionId}.push-${process.pid}-${Date.now()}`,
    );
    await rm(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true, mode: 0o700 });
    try {
      writeFileSync(join(stage, "manifest.json"), version.manifest);
      writeFileSync(join(stage, "registry.json"), version.registry);
      writeFileSync(join(stage, "lock.yaml"), version.lock);
      // The full listing, server files included, so the version can be checked as built.
      writeFileSync(join(stage, "listing.json"), JSON.stringify(version.listing));
      for (const [path, , sha] of clientFiles) {
        const target = join(stage, ...path.split("/"));
        // Checked again where it lands: nothing a tenant names leaves its own staging directory.
        if (relative(stage, target).startsWith("..") || isAbsolute(relative(stage, target))) {
          throw refuse("MOSTRA_HOME_INTEGRITY", "The listing names a path outside the version.");
        }
        mkdirSync(join(target, ".."), { recursive: true, mode: 0o700 });
        const stored = join(options.filesDir, sha);
        try {
          linkSync(stored, target);
        } catch {
          await copyFile(stored, target);
        }
      }
      await registry.store.promote(stage, version.versionId);
    } catch (error) {
      await rm(stage, { recursive: true, force: true });
      throw error;
    }
    const committed = registry.commit({
      artifactId: params.artifactId,
      bindingPath: undefined,
      number: version.number,
      manifestId: params.artifactId,
      versionId: version.versionId,
      sourceDigest: version.sourceDigest,
      envDigest: version.envDigest,
      outputDigest: version.outputDigest,
      manifest: manifest.data,
      // The owner's policy in force, as the owner's host decided it (D102): it sticks here.
      policy: version.policy,
      forcedCodes: [],
      stillClaims: () => false,
    });
    directory.write((db) => {
      for (const sha of new Set(clientFiles.map(([, , file]) => file))) {
        const added = db.run(
          "INSERT OR IGNORE INTO home_file (home_id, sha256) VALUES (?, ?)",
          id,
          sha,
        );
        if (added.changes > 0) {
          db.run(
            "INSERT INTO file_ref (sha256, homes) VALUES (?, 1) ON CONFLICT (sha256) DO UPDATE SET homes = homes + 1, unreferenced_at = NULL",
            sha,
          );
        }
      }
    });
    log.info("server.version_pushed", {
      home: id,
      artifactId: params.artifactId,
      versionId: version.versionId,
    });
    return { status: "complete", versionId: version.versionId, number: committed.version, route };
  };

  const describe = (): InstanceInfo => {
    const head = ledger.read(
      (db) =>
        db.get<{ cursor: number | null }>("SELECT MAX(cursor) AS cursor FROM event")?.cursor ?? 0,
    );
    return {
      version: options.runtimeVersion,
      home: `hosted:${id}`,
      platform: platformName(),
      pid: process.pid,
      mode: "hosted",
      incarnation,
      cursor: String(head),
    };
  };

  protocol = new ProtocolServer({
    log,
    describe,
    servesHome: () => false,
    supportedPorts: ["submissions", "relay"],
    notifications: ["events/notify"],
    admit: (session, params) => {
      // The owner instance is the witness a restore can't roll back: a home that holds less than
      // its owner committed, or saw less of its relay, was restored to an earlier copy, and rotates
      // its incarnation before it answers (INTERFACES §18.2).
      const link = params.link;
      if (link !== undefined && link.instanceId === session.attributes["linkId"]) {
        const marks = ledger.read((db) => ({
          head: db.get<{ head: number | null }>("SELECT MAX(cursor) AS head FROM event")?.head ?? 0,
          relayHigh:
            db.get<{ high: number | null }>(
              "SELECT MAX(relay_seq) AS high FROM relay_run WHERE owner_link_id = ?",
              link.instanceId,
            )?.high ?? 0,
        }));
        const followedAhead =
          link.followed !== undefined &&
          link.followed.incarnation === incarnation &&
          Number(link.followed.cursor) > marks.head;
        const relayAhead = link.relayMark > marks.relayHigh;
        if (followedAhead || relayAhead) {
          incarnation = rotateIncarnation(ledger);
          log.warn("server.home_rotated", {
            home: id,
            why: followedAhead ? "owner-cursor" : "owner-relay-mark",
          });
        }
      }
      // An owner link is its own grant's: a session can't speak for another instance's link.
      if (params.link !== undefined && params.link.instanceId !== session.attributes["linkId"]) {
        throw refuse(
          "MOSTRA_REMOTE_NOT_OWNER_INSTANCE",
          "This binding's sign-in is for another instance link.",
        );
      }
      // A session that takes deliveries or relayed runs is an owner instance's, so it names its own
      // link: one without a link could otherwise be taken for an owner by its client name (Opus
      // review of WP-29, 6).
      if (params.link === undefined && params.ports.length > 0) {
        throw refuse(
          "MOSTRA_REMOTE_NOT_OWNER_INSTANCE",
          "A binding that registers ports must name its own instance link.",
        );
      }
    },
    onInitialized: (session) => {
      interaction.connected(session);
      relay.connected(session);
    },
    onClosed: (session) => {
      interaction.disconnected(session);
      relay.disconnected(session);
    },
    handlers: [
      ...interaction.methods(),
      handler(artifactListMethod, (params) => ({ artifacts: registry.list(params.filter ?? {}) })),
      handler(artifactGetMethod, (params) => registry.get(canonicalRef(params.artifact))),
      handler(hostedPushMethod, (params, session) => push(params, session)),
      handler(hostedSubmissionMethod, (params, session) => {
        // Only the owner instance of its artifact reads a submission this way (D165 item 1b),
        // and only one it was, or is, delivered.
        const link = session.link?.instanceId;
        const envelope =
          link === undefined ? undefined : interaction.envelopeFor(params.submissionId, link);
        if (!envelope) {
          throw refuse(
            "MOSTRA_HOST_INVALID_PARAMS",
            `This home delivers no submission ${params.submissionId} to this instance.`,
          );
        }
        return envelope;
      }),
      ...gateway.methods(),
      ...relay.methods(),
      ...liveMethods(live, (ref) => registry.get(canonicalRef(ref)).id),
      handler(remoteTokenMethod, (params, session) => {
        const found = options.auth.authenticate(params.accessToken);
        if (!found || found.grantId !== session.attributes["grantId"]) {
          throw refuse(
            "MOSTRA_REMOTE_LOGIN_FAILED",
            "That access token isn't this binding's grant's.",
          );
        }
        const replace = session.attributes["replaceToken"] as
          | ((expiresAt: number) => void)
          | undefined;
        replace?.(found.expiresAt);
        return { expiresAt: new Date(found.expiresAt).toISOString() };
      }),
    ],
  });
  interaction.start();
  live.start();

  return {
    id,
    dir,
    ledger,
    registry,
    interaction,
    protocol,
    incarnation: () => incarnation,
    wanted: (sha) => [...pending.values()].some((files) => files.has(sha)),
    uploaded(sha) {
      directory.write((db) => {
        const added = db.run(
          "INSERT OR IGNORE INTO home_file (home_id, sha256) VALUES (?, ?)",
          id,
          sha,
        );
        if (added.changes > 0) {
          db.run(
            "INSERT INTO file_ref (sha256, homes) VALUES (?, 1) ON CONFLICT (sha256) DO UPDATE SET homes = homes + 1, unreferenced_at = NULL",
            sha,
          );
        }
      });
      for (const files of pending.values()) files.delete(sha);
    },
    busy: () => protocol.connections > 0 || bus.activeViews() > 0 || relay.busy(),
    serve,
    async stop() {
      relay.stop();
      live.stop();
      interaction.stop();
      await gateway.close();
      await protocol.close();
      bus.close?.();
    },
  };
}

/**
 * What is wrong with a hosted version's stored files (FAILURE_MODEL §3): its listing must be the
 * one its output digest names, and every client file it lists present with its bytes. Server files
 * are listed but never stored (D165 item 3).
 */
async function hostedDamage(versionDir: string): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(versionDir, "manifest.json"), "utf8")) as {
      outputDigest?: string;
    };
    const listing = JSON.parse(await readFile(join(versionDir, "listing.json"), "utf8")) as [
      string,
      boolean,
      string,
      number,
    ][];
    const listed = listing.map(([path, executable, sha256]) => ({ path, executable, sha256 }));
    if (listingDigest(listed) !== manifest.outputDigest)
      return "its listing doesn't match its digest";
    for (const [path, , sha256] of listing) {
      if (!path.startsWith("client/") && path !== "registry.json") continue;
      const bytes = await readFile(join(versionDir, ...path.split("/")));
      if (createHash("sha256").update(bytes).digest("hex") !== sha256) return `${path} was changed`;
    }
    return undefined;
  } catch (error) {
    return `a file is missing (${(error as NodeJS.ErrnoException).code ?? "unreadable"})`;
  }
}

/** The SHA-256 of a text's UTF-8 bytes, lowercase hex. */
function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
