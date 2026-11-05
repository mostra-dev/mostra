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
import { copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  ArtifactManifest,
  artifactGetMethod,
  artifactListMethod,
  createDiagnostic,
  type HostedPushParams,
  type HostedPushResult,
  type HostedRoute,
  hostedPushMethod,
  type InstanceInfo,
  RouteId,
  RpcError,
  remoteTokenMethod,
} from "@mostra/protocol";
import { coverageMatcher, readFieldCoverage } from "../builder/index.ts";
import { noFaults } from "../faults.ts";
import { platformName } from "../home/index.ts";
import { createInteraction, type Interaction } from "../interaction/index.ts";
import type { Ledger } from "../ledger/index.ts";
import type { Log } from "../log.ts";
import { handler, ProtocolServer, type Session } from "../protocol-server/index.ts";
import { canonicalRef, listingDigest, versionIdFor } from "../publish/index.ts";
import { openRegistry, type Registry } from "../registry/index.ts";
import type { Authorization } from "./auth.ts";

/** Lower-case Crockford base32, for route labels (one DNS label, 130 bits). */
const LABEL_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** A random route label: 26 lower-case Crockford base32 characters (INTERFACES §18.4). */
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
  stop(): Promise<void>;
}

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
  const incarnation = options.incarnation;

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
      if (path.split("/").some((part) => part === ".." || part === "" || part === ".")) {
        throw refuse("MOSTRA_HOME_INTEGRITY", `The listing names an unsafe path, ${path}.`);
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
      policy: undefined,
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
      // An owner link is its own grant's: a session can't speak for another instance's link.
      if (params.link !== undefined && params.link.instanceId !== session.attributes["linkId"]) {
        throw refuse(
          "MOSTRA_REMOTE_NOT_OWNER_INSTANCE",
          "This binding's sign-in is for another instance link.",
        );
      }
    },
    onInitialized: (session) => interaction.connected(session),
    onClosed: (session) => interaction.disconnected(session),
    handlers: [
      ...interaction.methods(),
      handler(artifactListMethod, (params) => ({ artifacts: registry.list(params.filter ?? {}) })),
      handler(artifactGetMethod, (params) => registry.get(canonicalRef(params.artifact))),
      handler(hostedPushMethod, (params, session) => push(params, session)),
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
    busy: () => protocol.connections > 0,
    async stop() {
      interaction.stop();
      await protocol.close();
    },
  };
}

/** The SHA-256 of a text's UTF-8 bytes, lowercase hex. */
function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
