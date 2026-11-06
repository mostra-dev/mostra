/**
 * The owner instance's links to remote servers (ARCHITECTURE §15.3, INTERFACES §18.2, D165 items 1
 * to 3): sign-in by the device grant, the refresh token kept in the home and the access token in
 * memory, one binding per signed-in server, and over it the hosted home's deliveries (imported into
 * this home's ledger and its own outbox in one transaction), the sync cursor (the hosted home's
 * events copied once each), and version pushes, queued while a server can't be reached.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  createDiagnostic,
  type EventsNotifyParams,
  eventsAckMethod,
  eventsSubscribeMethod,
  type HostedPushResult,
  type HostedRoute,
  hostedPushMethod,
  type ListingEntry,
  type MethodDefinition,
  portSubmissionsDeliverMethod,
  type RemoteLink,
  type RemoteLoginResult,
  RpcError,
  remoteLoginMethod,
  remoteLoginWaitMethod,
  remoteLogoutMethod,
  remoteStatusMethod,
  remoteTokenMethod,
  type ServerLiveValueParams,
  SubmissionEnvelope,
  type SubmissionPolicy,
  type SubmissionsDeliverResult,
  type VersionPush,
  viewRevokeMethod,
  viewUrlMethod,
} from "@mostra/protocol";
import { appendEvent, followEvents, type ImportSource } from "../interaction/index.ts";
import type { Ledger, LedgerDb } from "../ledger/index.ts";
import type { Environment, Log } from "../log.ts";
import { renamePathSync } from "../platform/index.ts";
import { handler, type MethodHandler } from "../protocol-server/index.ts";
import { listingDigest } from "../publish/index.ts";
import type { RemoteShares } from "../share/index.ts";
import { type Binding, type BindingSession, ownerInitialize, startBinding } from "./binding.ts";
import { postForm, type RemoteAddress, remoteRequest, testServerAddress } from "./http.ts";
import { createOwnerRelay, type OwnerRelayOptions } from "./relay.ts";

/** The CLI's client ID at every server's authorization server (D166 item 5). */
const CLIENT_ID = "mostra-cli";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
/** A token is refreshed this long before it expires, so a binding never meets its expiry. */
const REFRESH_AHEAD_MS = 5 * 60_000;
/** The first retry of a push that failed; each later one doubles, up to five minutes. */
const PUSH_RETRY_MS = 1_000;
const PUSH_RETRY_MAX_MS = 5 * 60_000;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A server's short, stable key: 16 Crockford base32 characters of the SHA-256 of its origin. */
export function serverKey(server: string): string {
  const digest = createHash("sha256").update(server, "utf8").digest();
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of digest) {
    buffer = ((buffer << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5 && out.length < 16) {
      bits -= 5;
      out += CROCKFORD.charAt((buffer >> bits) & 31);
    }
    if (out.length >= 16) break;
  }
  return out;
}

/** An API origin as the instance keeps it: scheme and host, no path. */
export function serverOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : `https://${value}`);
  } catch {
    throw invalid(`${value} isn't a server address.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw invalid(`${value} isn't an https: address.`);
  if (url.protocol === "http:" && !loopbackName(url.hostname)) {
    throw invalid(`${value} must be https: (plain http is only for a server on this machine).`);
  }
  return url.origin;
}

function loopbackName(host: string): boolean {
  return (
    host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "[::1]"
  );
}

function invalid(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", { message }));
}

function loginFailed(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_REMOTE_LOGIN_FAILED", { message }));
}

/** What the link keeps for a server in `<home>/keys/remote/<server key>.json` (DATA_MODEL §7.3). */
interface Credentials {
  readonly server: string;
  readonly refreshToken: string;
  readonly instanceId: string;
}

/** A `remote_link` row. */
interface LinkRow {
  readonly server: string;
  readonly account_id: string | null;
  readonly account_name: string | null;
  readonly instance_id: string | null;
  readonly is_default: number;
  readonly linked_at: string;
  readonly state: "signed-in" | "signed-out";
  readonly incarnation: string | null;
  readonly follow_cursor: string | null;
  readonly relay_mark: number;
}

/** What the link needs from the instance. */
export interface LinkOptions {
  readonly home: string;
  readonly ledger: Ledger;
  readonly log: Log;
  readonly env: Environment;
  readonly runtimeVersion: string;
  /** Registers a value no log or event may show (the instance's redactor). */
  readonly protect: (value: string) => void;
  /** Imports a delivered hosted submission (the interaction core's, D165 item 1). */
  readonly importSubmission: (
    envelope: SubmissionEnvelope,
    source: ImportSource,
  ) => SubmissionsDeliverResult;
  /** A version's sealed directory. */
  readonly versionDir: (versionId: string) => string;
  /** Runs what hosted homes relay here (D165 item 4). */
  readonly actions: OwnerRelayOptions["actions"];
  /** Hosted pages' live interest changed. */
  readonly liveChanged?: () => void;
  /** The clock (tests move it). */
  readonly now?: () => number;
}

/** A pushed version's answer: its hosted route. */
export interface Pushed {
  readonly versionId: string;
  readonly number: number;
  readonly route: HostedRoute;
  readonly server: string;
  readonly home: string;
}

/** The owner's side of every remote server this home links to. */
export interface Link {
  /** The `remote/*` methods for the instance's own clients. */
  methods(): MethodHandler[];
  /** Dials every server this home is signed in to. */
  start(): void;
  stop(): Promise<void>;
  /** The server a name means: the given one, or the one signed in to last. */
  resolveServer(server: string | undefined): string;
  /**
   * Hosts an artifact on a server: records it as hosted there and pushes its latest version, so
   * every later publish follows (D165 item 3). Resolves once the server holds the version.
   */
  host(artifactId: string, server: string): Promise<Pushed>;
  /** A publish of an artifact hosted somewhere: queue its push to every such server. */
  published(artifactId: string, versionId: string): void;
  /** The open session with a server's hosted home, waiting for one up to `timeoutMs`. */
  session(server: string, timeoutMs?: number): Promise<BindingSession>;
  /** Whether a server's binding is open now. */
  connected(server: string): boolean;
  /** `remote` shares (INTERFACES §18.2): hosted links minted on this home's hosted homes. */
  shares(): RemoteShares;
  /** This home's links, as `remote/status` answers them. */
  status(): RemoteLink[];
  /**
   * The server an artifact is hosted on, whose hosted home holds its shared state and live values
   * (D165 item 1); `undefined` for an artifact that isn't hosted. Shared to several servers, the
   * first it was shared to.
   */
  hostedOn(artifactId: string): string | undefined;
  /**
   * Calls a method on a server's hosted home for this home's client: a hosted artifact's
   * `state/*` and `live/push` (D165 item 1). `MOSTRA_REMOTE_UNREACHABLE` when it can't be reached.
   */
  forward<P, R>(server: string, definition: MethodDefinition<P, R>, params: P): Promise<R>;
  /** The live sources hosted pages want of this instance's producers (D165 item 4). */
  liveInterest(): Iterable<{ readonly artifactId: string; readonly key: string }>;
  /**
   * A produced value of a hosted artifact goes to its hosted home, its one copy (D165 item 1):
   * `true` when the artifact is hosted, and nothing is kept here.
   */
  forwardLive(artifactId: string, versionId: string, produced: ServerLiveValueParams): boolean;
}

/** One server's link at run time. */
interface Connection {
  readonly server: string;
  binding: Binding;
  access?: { token: string; expiresAt: number };
  refreshing?: Promise<string> | undefined;
  refreshTimer?: ReturnType<typeof setTimeout> | undefined;
  state: RemoteLink["state"];
  since: string;
  lastError?: string;
  home?: string;
  incarnation?: string;
  pushing?: Promise<void> | undefined;
  pushTimer?: ReturnType<typeof setTimeout> | undefined;
}

/** A sign-in in progress: the device grant's code and its outcome. */
interface Login {
  readonly id: string;
  readonly server: string;
  readonly result: RemoteLoginResult;
  outcome?:
    | { ok: true; account: { id: string; name?: string }; instanceId: string }
    | { ok: false; error: RpcError };
  waiters: (() => void)[];
}

/** Creates the owner's link manager. */
export function createLink(options: LinkOptions): Link {
  const { ledger, log } = options;
  const now = options.now ?? Date.now;
  const connectTo: RemoteAddress | undefined = testServerAddress(
    options.env["MOSTRA_TEST_SERVER_ADDRESS"],
  );
  const keysDir = join(options.home, "keys", "remote");
  const connections = new Map<string, Connection>();
  const logins = new Map<string, Login>();
  let stopped = false;

  const credentialsFile = (server: string): string => join(keysDir, `${serverKey(server)}.json`);
  const readCredentials = (server: string): Credentials | undefined => {
    const file = credentialsFile(server);
    if (!existsSync(file)) return undefined;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Credentials;
      if (parsed.server !== server || typeof parsed.refreshToken !== "string") return undefined;
      options.protect(parsed.refreshToken);
      return parsed;
    } catch {
      return undefined;
    }
  };
  const writeCredentials = (credentials: Credentials): void => {
    mkdirSync(keysDir, { recursive: true, mode: 0o700 });
    options.protect(credentials.refreshToken);
    // Written beside it, then renamed: a crash never leaves half a token (as secrets are, D131).
    const target = credentialsFile(credentials.server);
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(credentials), { mode: 0o600 });
    renamePathSync(temporary, target);
  };
  const forgetCredentials = (server: string): void => {
    rmSync(credentialsFile(server), { force: true });
  };
  /**
   * The hosted links this home's remote shares minted, kept beside its credentials (mode 0600,
   * never in the ledger, D44), so `share/list` shows them again: their secrets are the hosted
   * home's, which this home can't derive.
   */
  const linksFile = (server: string): string => join(keysDir, `${serverKey(server)}.links.json`);
  const readLinks = (server: string): Record<string, string> => {
    try {
      const parsed = JSON.parse(readFileSync(linksFile(server), "utf8")) as Record<string, string>;
      for (const url of Object.values(parsed)) protectLink(url);
      return parsed;
    } catch {
      return {};
    }
  };
  const writeLinks = (server: string, links: Record<string, string>): void => {
    mkdirSync(keysDir, { recursive: true, mode: 0o700 });
    const target = linksFile(server);
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(links), { mode: 0o600 });
    renamePathSync(temporary, target);
  };
  /** A link's secret is in its fragment: it never reaches a log. */
  const protectLink = (url: string): void => {
    const secret = /#t=([^&]+)/.exec(url)?.[1];
    if (secret !== undefined) options.protect(secret);
  };

  const linkRow = (db: LedgerDb, server: string): LinkRow | undefined =>
    db.get<LinkRow>("SELECT * FROM remote_link WHERE server = ?", server);

  const owned =
    (server: string) =>
    (db: LedgerDb, artifactId: string): boolean =>
      db.get(
        "SELECT 1 FROM hosted_artifact WHERE artifact_id = ? AND server = ?",
        artifactId,
        server,
      ) !== undefined;

  /** A fresh access token, refreshing (and rotating the refresh token) when it's due. */
  const accessToken = (connection: Connection): Promise<string> => {
    if (connection.access && connection.access.expiresAt - now() > REFRESH_AHEAD_MS) {
      return Promise.resolve(connection.access.token);
    }
    connection.refreshing ??= (async () => {
      try {
        const credentials = readCredentials(connection.server);
        if (!credentials) throw loginFailed(`This home isn't signed in to ${connection.server}.`);
        const answer = await postForm(
          connection.server,
          "/oauth/token",
          {
            client_id: CLIENT_ID,
            grant_type: "refresh_token",
            refresh_token: credentials.refreshToken,
          },
          connectTo,
        );
        if (answer.status !== 200 || typeof answer.json["access_token"] !== "string") {
          const error = String(answer.json["error"] ?? answer.status);
          if (error === "invalid_grant")
            signedOut(connection, "the sign-in was revoked or has expired");
          throw loginFailed(`${connection.server} refused this home's sign-in (${error}).`);
        }
        const token = answer.json["access_token"] as string;
        const refresh = answer.json["refresh_token"];
        options.protect(token);
        // The rotated refresh token is durable before the access token is used (§18.5).
        if (typeof refresh === "string")
          writeCredentials({ ...credentials, refreshToken: refresh });
        connection.access = {
          token,
          expiresAt: now() + Number(answer.json["expires_in"] ?? 3600) * 1000,
        };
        scheduleRefresh(connection);
        return token;
      } finally {
        connection.refreshing = undefined;
      }
    })();
    return connection.refreshing;
  };

  /** Refreshes the token in band before it expires, so the server never closes the binding. */
  const scheduleRefresh = (connection: Connection): void => {
    if (connection.refreshTimer) clearTimeout(connection.refreshTimer);
    if (!connection.access) return;
    const delay = Math.max(1_000, connection.access.expiresAt - now() - REFRESH_AHEAD_MS + 1_000);
    connection.refreshTimer = setTimeout(() => {
      connection.refreshTimer = undefined;
      void (async () => {
        try {
          const token = await accessToken(connection);
          const session = connection.binding.session;
          if (session) await session.call(remoteTokenMethod, { accessToken: token });
        } catch (error) {
          log.warn("link.refresh_failed", {
            server: connection.server,
            error: (error as Error).message,
          });
        }
      })();
    }, delay);
    connection.refreshTimer.unref?.();
  };

  const signedOut = (connection: Connection, why: string): void => {
    connection.state = "signed-out";
    connection.lastError = why;
    connection.since = new Date(now()).toISOString();
    ledger.write((db) =>
      db.run("UPDATE remote_link SET state = 'signed-out' WHERE server = ?", connection.server),
    );
    void connection.binding.stop();
    log.warn("link.signed_out", { server: connection.server, why });
  };

  /** Copies one page of followed events, then acknowledges it (the sync cursor, §18.2). */
  const follow = (
    connection: Connection,
    page: EventsNotifyParams,
    session: BindingSession,
  ): void => {
    const home = connection.home;
    const incarnation = connection.incarnation;
    if (!home || !incarnation) return;
    const source: ImportSource = {
      server: connection.server,
      serverKey: serverKey(connection.server),
      home,
      incarnation,
    };
    const outcome = ledger.write((db) => {
      const followed = followEvents(db, {
        events: page.events,
        source,
        owned: owned(connection.server),
      });
      db.run(
        "UPDATE remote_link SET follow_cursor = ?, incarnation = ? WHERE server = ?",
        page.cursor,
        incarnation,
        connection.server,
      );
      return followed;
    });
    if (outcome.missing.length > 0) {
      log.warn("link.follow_missing_submissions", {
        server: connection.server,
        submissions: outcome.missing,
      });
    }
    session.notify(eventsAckMethod.method, {
      subscriptionId: page.subscriptionId,
      cursor: page.cursor,
    });
  };

  /** Every binding message, appended to a file (tests: the relay's secrets grep). */
  const traceFile = options.env["MOSTRA_TEST_BINDING_TRACE"];
  const trace =
    traceFile === undefined || traceFile === ""
      ? undefined
      : (direction: "out" | "in", text: string): void =>
          appendFileSync(traceFile, `${direction} ${text}\n`);
  /**
   * The binding's session, or the one opening now: a relay message can arrive while the session's
   * own start (its subscription) is still under way, and an update sent then mustn't be lost.
   */
  const readyMs = Number(options.env["MOSTRA_TEST_RELAY_READY_MS"] ?? "") || 10_000;
  const readySoon = (connection: Connection): Promise<BindingSession | undefined> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      connection.binding.ready(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), readyMs);
      }),
    ]).finally(() => clearTimeout(timer));
  };
  const relay = createOwnerRelay({
    ledger,
    log,
    actions: options.actions,
    now,
    loseAcks: Number(options.env["MOSTRA_TEST_RELAY_LOSE_ACK"] ?? "0") || 0,
    ...(options.liveChanged ? { liveChanged: options.liveChanged } : {}),
  });

  const onRequest =
    (connection: Connection) =>
    (method: string, params: unknown): unknown => {
      if (relay.handles(method)) {
        return relay.request(
          connection.server,
          () => connection.binding.session ?? readySoon(connection),
          method,
          params,
          () => connection.binding.reconnect(),
        );
      }
      if (method === portSubmissionsDeliverMethod.method) {
        const parsed = SubmissionEnvelope.safeParse(
          (params as { envelope?: unknown })?.envelope ?? params,
        );
        if (!parsed.success)
          return { accepted: false, reason: "invalid: not a submission envelope", retry: false };
        if (!connection.home || !connection.incarnation) {
          return { accepted: false, reason: "the session isn't open yet", retry: true };
        }
        return options.importSubmission(parsed.data, {
          server: connection.server,
          serverKey: serverKey(connection.server),
          home: connection.home,
          incarnation: connection.incarnation,
        });
      }
      throw new RpcError(
        createDiagnostic("MOSTRA_HOST_METHOD_UNKNOWN", {
          message: `This instance doesn't serve ${method}.`,
        }),
      );
    };

  const connect = (server: string): Connection => {
    const existing = connections.get(server);
    if (existing && existing.state !== "signed-out") return existing;
    const connection: Connection = {
      server,
      binding: undefined as unknown as Binding,
      state: "connecting",
      since: new Date(now()).toISOString(),
    };
    connections.set(server, connection);
    connection.binding = startBinding({
      ...(trace ? { trace } : {}),
      server,
      ...(connectTo ? { connectTo } : {}),
      accessToken: () => accessToken(connection),
      initialize: () => {
        const row = ledger.read((db) => linkRow(db, server));
        return ownerInitialize({
          name: "mostra-runtime",
          version: options.runtimeVersion,
          instanceId: row?.instance_id ?? "",
          relayMark: row?.relay_mark ?? 0,
          ...(row?.incarnation && row.follow_cursor
            ? { followed: { incarnation: row.incarnation, cursor: row.follow_cursor } }
            : {}),
        });
      },
      onRequest: onRequest(connection),
      onNotification: (method, params) => {
        if (method !== "events/notify") return;
        const session = connection.binding.session;
        if (session) follow(connection, params as EventsNotifyParams, session);
      },
      onOpen: async (session) => {
        connection.home = session.result.instance.home;
        connection.incarnation = session.result.instance.incarnation ?? "";
        const row = ledger.read((db) => linkRow(db, server));
        const sameIncarnation = row?.incarnation === connection.incarnation;
        // A new incarnation is a hosted home restored from a backup (FAILURE_MODEL §11.2): this
        // instance keeps what it imported, continues after the lower of what it committed and the
        // restored head, and records the window the server lost (`remote.regressed`).
        const head = session.result.instance.cursor ?? "0";
        const regressed =
          row?.incarnation !== null &&
          row?.incarnation !== undefined &&
          !sameIncarnation &&
          row.follow_cursor !== null;
        const after = sameIncarnation
          ? (row?.follow_cursor ?? undefined)
          : regressed
            ? String(Math.min(Number(row?.follow_cursor ?? "0"), Number(head)))
            : undefined;
        if (regressed) {
          ledger.write((db) => {
            appendEvent(db, {
              artifactId: null,
              type: "remote.regressed",
              actor: { kind: "mostra" },
              payload: {
                server,
                home: connection.home,
                from: row?.follow_cursor,
                to: head,
                incarnation: { from: row?.incarnation, to: connection.incarnation },
              },
            });
            db.run(
              "UPDATE remote_link SET follow_cursor = ?, incarnation = ? WHERE server = ?",
              after ?? null,
              connection.incarnation ?? null,
              server,
            );
          });
          log.warn("link.home_regressed", { server, from: row?.follow_cursor, to: head });
        }
        await session.call(eventsSubscribeMethod, {
          name: `owner:${row?.instance_id ?? ""}`,
          ...(after !== undefined ? { after } : {}),
        });
        connection.state = "connected";
        connection.since = new Date(now()).toISOString();
        delete connection.lastError;
        void drainPushes(connection);
      },
      onClose: (why) => {
        relay.closed(server);
        if (connection.state === "signed-out") return;
        if (connection.state === "connected") connection.since = new Date(now()).toISOString();
        connection.state = "offline";
        connection.lastError = why;
      },
      onUnauthorized: () => {
        delete connection.access;
      },
      log,
    });
    return connection;
  };

  /** The canonical listing of a version's output, with sizes (DATA_MODEL §2), read from its directory. */
  const listingOf = (versionDir: string): ListingEntry[] => {
    const entries: ListingEntry[] = [];
    const walk = (dir: string, relative: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${relative}/${entry.name}`;
        const absolute = join(dir, entry.name);
        if (entry.isDirectory()) walk(absolute, path);
        else if (entry.isFile()) {
          const bytes = readFileSync(absolute);
          entries.push([
            path,
            false,
            createHash("sha256").update(bytes).digest("hex"),
            bytes.length,
          ]);
        }
      }
    };
    for (const top of ["client", "server"]) {
      if (existsSync(join(versionDir, top))) walk(join(versionDir, top), top);
    }
    const registry = readFileSync(join(versionDir, "registry.json"));
    entries.push([
      "registry.json",
      false,
      createHash("sha256").update(registry).digest("hex"),
      registry.length,
    ]);
    return entries;
  };

  /** Pushes one version: the push, then the files the server names as missing, then the push again. */
  const pushVersion = async (
    connection: Connection,
    artifactId: string,
    versionId: string,
  ): Promise<Pushed> => {
    const row = ledger.read((db) =>
      db.get<{ number: number; source_digest: string; env_digest: string; output_digest: string }>(
        "SELECT number, source_digest, env_digest, output_digest FROM version WHERE id = ? AND artifact_id = ?",
        versionId,
        artifactId,
      ),
    );
    if (!row) throw invalid(`${artifactId} has no version ${versionId}.`);
    const dir = options.versionDir(versionId);
    const listing = listingOf(dir);
    if (
      listingDigest(listing.map(([path, executable, sha256]) => ({ path, executable, sha256 }))) !==
      row.output_digest
    ) {
      throw new RpcError(
        createDiagnostic("MOSTRA_HOME_INTEGRITY", {
          message: `Version ${versionId}'s files don't match its output digest; publish its source again first.`,
        }),
      );
    }
    const version: VersionPush = {
      versionId,
      number: row.number,
      sourceDigest: row.source_digest,
      envDigest: row.env_digest,
      outputDigest: row.output_digest,
      manifest: readFileSync(join(dir, "manifest.json"), "utf8"),
      registry: readFileSync(join(dir, "registry.json"), "utf8"),
      lock: readFileSync(join(dir, "lock.yaml"), "utf8"),
      listing,
      // The policy in force here (D102): the hosted home follows the owner's host's choice.
      ...(() => {
        const found = ledger.read(
          (db) =>
            db.get<{ policy_json: string | null }>(
              "SELECT policy_json FROM artifact WHERE id = ?",
              artifactId,
            )?.policy_json,
        );
        return found ? { policy: JSON.parse(found) as SubmissionPolicy } : {};
      })(),
    };
    const session = await connection.binding.ready();
    let answer: HostedPushResult = await session.call(hostedPushMethod, { artifactId, version });
    for (let round = 0; answer.status === "missing" && round < 3; round += 1) {
      const wanted = new Set(answer.files);
      const token = await accessToken(connection);
      for (const [path, , sha256, size] of listing) {
        if (!wanted.has(sha256) || !path.startsWith("client/")) continue;
        wanted.delete(sha256);
        const body = readFileSync(join(dir, path));
        if (body.length !== size) throw invalid(`${path} changed while it was pushed.`);
        const put = await remoteRequest(connection.server, `/files/${sha256}`, {
          method: "PUT",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
          body,
          timeoutMs: 300_000,
          ...(connectTo ? { connectTo } : {}),
        });
        if (put.status !== 201 && put.status !== 200) {
          throw new RpcError(
            createDiagnostic("MOSTRA_REMOTE_UNREACHABLE", {
              message: `${connection.server} refused the file ${path} (${put.status}).`,
            }),
          );
        }
      }
      answer = await session.call(hostedPushMethod, { artifactId, version });
    }
    if (answer.status !== "complete") {
      throw new RpcError(
        createDiagnostic("MOSTRA_REMOTE_UNREACHABLE", {
          message: `${connection.server} still lacks files of ${versionId} after they were sent.`,
        }),
      );
    }
    ledger.write((db) => {
      db.run(
        "UPDATE hosted_artifact SET hosted_home = ?, route_id = ?, label = ? WHERE artifact_id = ? AND server = ?",
        session.result.instance.home,
        answer.route.routeId,
        answer.route.label,
        artifactId,
        connection.server,
      );
      db.run(
        "UPDATE version_push SET state = 'complete' WHERE artifact_id = ? AND version_id = ? AND server = ?",
        artifactId,
        versionId,
        connection.server,
      );
    });
    log.info("link.pushed", { server: connection.server, artifactId, versionId });
    return {
      versionId,
      number: answer.number,
      route: answer.route,
      server: connection.server,
      home: session.result.instance.home,
    };
  };

  /** Sends every pending push of a server, oldest first, retrying with backoff while it fails. */
  const drainPushes = (connection: Connection, attempt = 0): Promise<void> => {
    connection.pushing ??= (async () => {
      try {
        for (;;) {
          if (stopped || !connection.binding.session) return;
          const next = ledger.read((db) =>
            db.get<{ artifact_id: string; version_id: string }>(
              "SELECT artifact_id, version_id FROM version_push WHERE server = ? AND state = 'pending' ORDER BY created_at, rowid LIMIT 1",
              connection.server,
            ),
          );
          if (!next) return;
          await pushVersion(connection, next.artifact_id, next.version_id);
        }
      } catch (error) {
        log.warn("link.push_failed", {
          server: connection.server,
          error: (error as Error).message,
        });
        ledger.write((db) =>
          db.run(
            "UPDATE version_push SET attempts = attempts + 1 WHERE server = ? AND state = 'pending'",
            connection.server,
          ),
        );
        if (connection.pushTimer || stopped) return;
        connection.pushTimer = setTimeout(
          () => {
            connection.pushTimer = undefined;
            void drainPushes(connection, attempt + 1);
          },
          Math.min(PUSH_RETRY_MAX_MS, PUSH_RETRY_MS * 2 ** attempt),
        );
        connection.pushTimer.unref?.();
      } finally {
        connection.pushing = undefined;
      }
    })();
    return connection.pushing;
  };

  const queuePush = (db: LedgerDb, artifactId: string, versionId: string, server: string): void => {
    db.run(
      `INSERT INTO version_push (artifact_id, version_id, server, state, attempts, created_at) VALUES (?, ?, ?, 'pending', 0, ?)
       ON CONFLICT (artifact_id, version_id, server) DO NOTHING`,
      artifactId,
      versionId,
      server,
      new Date(now()).toISOString(),
    );
  };

  const resolveServer = (server: string | undefined): string => {
    if (server !== undefined) return serverOrigin(server);
    const last = ledger.read((db) =>
      db.get<{ server: string }>("SELECT server FROM remote_link ORDER BY linked_at DESC LIMIT 1"),
    );
    if (!last) {
      throw invalid(
        "Name the server to sign in to: mostra login <server>. No server is configured by default.",
      );
    }
    return last.server;
  };

  /** Starts a sign-in: the device grant's code, then polls for the token in the background. */
  const login = async (
    requested: string | undefined,
    makeDefault = false,
  ): Promise<RemoteLoginResult> => {
    const server = resolveServer(requested);
    const existing = ledger.read((db) => linkRow(db, server));
    const started = await postForm(
      server,
      "/oauth/device",
      {
        client_id: CLIENT_ID,
        mostra_name: hostname().slice(0, 128) || "Mostra instance",
        ...(existing?.instance_id ? { mostra_instance: existing.instance_id } : {}),
        ...(makeDefault ? { mostra_default: "1" } : {}),
      },
      connectTo,
    );
    const deviceCode = started.json["device_code"];
    const userCode = started.json["user_code"];
    const uri = started.json["verification_uri"];
    if (
      started.status !== 200 ||
      typeof deviceCode !== "string" ||
      typeof userCode !== "string" ||
      typeof uri !== "string"
    ) {
      throw loginFailed(
        `${server} didn't start a sign-in (${String(started.json["error"] ?? started.status)}).`,
      );
    }
    options.protect(deviceCode);
    const expiresIn = Number(started.json["expires_in"] ?? 600);
    const interval = Math.max(1, Number(started.json["interval"] ?? 5));
    const complete = started.json["verification_uri_complete"];
    const result: RemoteLoginResult = {
      loginId: `login_${randomUUID()}`,
      server,
      verificationUri: uri,
      ...(typeof complete === "string" ? { verificationUriComplete: complete } : {}),
      userCode,
      expiresAt: new Date(now() + expiresIn * 1000).toISOString(),
    };
    const pending: Login = { id: result.loginId, server, result, waiters: [] };
    logins.set(result.loginId, pending);
    const finish = (outcome: NonNullable<Login["outcome"]>): void => {
      pending.outcome = outcome;
      for (const wake of pending.waiters.splice(0)) wake();
      setTimeout(() => logins.delete(pending.id), 10 * 60_000).unref();
    };
    void (async () => {
      let wait = interval * 1000;
      const deadline = now() + expiresIn * 1000;
      while (!stopped && now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, wait).unref());
        let answer: { status: number; json: Record<string, unknown> };
        try {
          answer = await postForm(
            server,
            "/oauth/token",
            { client_id: CLIENT_ID, grant_type: DEVICE_GRANT, device_code: deviceCode },
            connectTo,
          );
        } catch {
          continue;
        }
        const error = answer.json["error"];
        if (error === "authorization_pending") continue;
        if (error === "slow_down") {
          wait += 5_000;
          continue;
        }
        if (answer.status !== 200 || typeof answer.json["refresh_token"] !== "string") {
          finish({
            ok: false,
            error: loginFailed(
              `${server} refused the sign-in (${String(error ?? answer.status)}).`,
            ),
          });
          return;
        }
        const account = answer.json["mostra_account"] as { id: string; name?: string };
        const instanceId = String(answer.json["mostra_instance"]);
        const refreshToken = answer.json["refresh_token"] as string;
        const accessToken = String(answer.json["access_token"]);
        options.protect(accessToken);
        writeCredentials({ server, refreshToken, instanceId });
        ledger.write((db) =>
          db.run(
            `INSERT INTO remote_link (server, account_id, account_name, instance_id, is_default, linked_at, state)
             VALUES (?, ?, ?, ?, ?, ?, 'signed-in')
             ON CONFLICT (server) DO UPDATE SET account_id = excluded.account_id, account_name = excluded.account_name,
               instance_id = excluded.instance_id, is_default = excluded.is_default, linked_at = excluded.linked_at,
               state = 'signed-in'`,
            server,
            account.id,
            account.name ?? null,
            instanceId,
            answer.json["mostra_default"] === true ? 1 : 0,
            new Date(now()).toISOString(),
          ),
        );
        const previous = connections.get(server);
        if (previous) {
          await previous.binding.stop();
          connections.delete(server);
        }
        const connection = connect(server);
        connection.access = {
          token: accessToken,
          expiresAt: now() + Number(answer.json["expires_in"] ?? 3600) * 1000,
        };
        scheduleRefresh(connection);
        log.info("link.signed_in", { server, instanceId });
        finish({
          ok: true,
          account: { id: account.id, ...(account.name ? { name: account.name } : {}) },
          instanceId,
        });
        return;
      }
      finish({
        ok: false,
        error: loginFailed(`The sign-in to ${server} expired before it was approved.`),
      });
    })();
    return result;
  };

  const status = (): RemoteLink[] =>
    ledger.read((db) => {
      const rows = db.all<LinkRow>("SELECT * FROM remote_link ORDER BY linked_at");
      return rows.map((row): RemoteLink => {
        const connection = connections.get(row.server);
        const pending =
          db.get<{ n: number }>(
            "SELECT COUNT(*) AS n FROM version_push WHERE server = ? AND state = 'pending'",
            row.server,
          )?.n ?? 0;
        const state: RemoteLink["state"] =
          row.state === "signed-out" ? "signed-out" : (connection?.state ?? "offline");
        return {
          server: row.server,
          account: {
            id: row.account_id ?? "",
            ...(row.account_name ? { name: row.account_name } : {}),
          },
          instanceId: row.instance_id ?? "",
          name: hostname().slice(0, 128) || "Mostra instance",
          default: row.is_default === 1,
          state,
          since: connection?.since ?? row.linked_at,
          pendingPushes: pending,
          ...(connection?.lastError ? { lastError: connection.lastError } : {}),
        };
      });
    });

  const self: Link = {
    methods() {
      return [
        handler(remoteLoginMethod, (params) => login(params.server, params.default === true)),
        handler(remoteLoginWaitMethod, async (params) => {
          const pending = logins.get(params.loginId);
          if (!pending) throw invalid(`No sign-in ${params.loginId} is in progress.`);
          if (!pending.outcome && params.timeoutMs > 0) {
            await new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, params.timeoutMs);
              pending.waiters.push(() => {
                clearTimeout(timer);
                resolve();
              });
            });
          }
          const outcome = pending.outcome;
          if (!outcome) return { status: "pending" as const };
          if (!outcome.ok) throw outcome.error;
          return {
            status: "signed-in" as const,
            server: pending.server,
            account: outcome.account,
            instanceId: outcome.instanceId,
          };
        }),
        handler(remoteLogoutMethod, async (params) => {
          const servers =
            params.server !== undefined
              ? [serverOrigin(params.server)]
              : ledger
                  .read((db) =>
                    db.all<{ server: string }>(
                      "SELECT server FROM remote_link WHERE state = 'signed-in'",
                    ),
                  )
                  .map((row) => row.server);
          const done: string[] = [];
          for (const server of servers) {
            const credentials = readCredentials(server);
            const connection = connections.get(server);
            if (connection) {
              await connection.binding.stop();
              if (connection.refreshTimer) clearTimeout(connection.refreshTimer);
              if (connection.pushTimer) clearTimeout(connection.pushTimer);
              connections.delete(server);
            }
            if (credentials) {
              try {
                await postForm(
                  server,
                  "/oauth/revoke",
                  { token: credentials.refreshToken, client_id: CLIENT_ID },
                  connectTo,
                );
              } catch (error) {
                // The token is forgotten here whatever the server says: a later sign-in rebinds the link.
                log.warn("link.revoke_failed", { server, error: (error as Error).message });
              }
            }
            forgetCredentials(server);
            // The instance link is kept unless --forget, so the artifacts it owns stay its own.
            ledger.write((db) =>
              db.run(
                `UPDATE remote_link SET state = 'signed-out'${params.forget ? ", instance_id = NULL" : ""} WHERE server = ?`,
                server,
              ),
            );
            done.push(server);
          }
          return { servers: done };
        }),
        handler(remoteStatusMethod, () => ({ links: status() })),
      ];
    },
    start() {
      const rows = ledger.read((db) =>
        db.all<{ server: string }>("SELECT server FROM remote_link WHERE state = 'signed-in'"),
      );
      for (const row of rows) {
        if (readCredentials(row.server)) connect(row.server);
      }
    },
    async stop() {
      stopped = true;
      for (const connection of connections.values()) {
        if (connection.refreshTimer) clearTimeout(connection.refreshTimer);
        if (connection.pushTimer) clearTimeout(connection.pushTimer);
        await connection.binding.stop();
      }
      connections.clear();
    },
    resolveServer,
    async host(artifactId, server) {
      const latest = ledger.write((db) => {
        const link = linkRow(db, server);
        if (link?.state !== "signed-in") {
          throw loginFailed(
            `This home isn't signed in to ${server}: run mostra login ${server} first.`,
          );
        }
        const artifact = db.get<{ latest_version_id: string | null }>(
          "SELECT latest_version_id FROM artifact WHERE id = ?",
          artifactId,
        );
        if (!artifact?.latest_version_id)
          throw invalid(`${artifactId} has no published version to share.`);
        db.run(
          `INSERT INTO hosted_artifact (artifact_id, server, hosted_home, route_id, label, shared_at) VALUES (?, ?, '', '', '', ?)
           ON CONFLICT (artifact_id, server) DO UPDATE SET stopped_at = NULL`,
          artifactId,
          server,
          new Date(now()).toISOString(),
        );
        queuePush(db, artifactId, artifact.latest_version_id, server);
        return artifact.latest_version_id;
      });
      const connection = connections.get(server) ?? connect(server);
      const pushed = await pushVersion(connection, artifactId, latest);
      void drainPushes(connection);
      return pushed;
    },
    published(artifactId, versionId) {
      const servers = ledger.write((db) => {
        const rows = db.all<{ server: string }>(
          "SELECT server FROM hosted_artifact WHERE artifact_id = ? AND stopped_at IS NULL",
          artifactId,
        );
        for (const row of rows) queuePush(db, artifactId, versionId, row.server);
        return rows.map((row) => row.server);
      });
      for (const server of servers) {
        const connection = connections.get(server);
        if (connection) void drainPushes(connection);
      }
    },
    async session(server, timeoutMs = 10_000) {
      const connection = connections.get(server);
      if (!connection || connection.state === "signed-out") {
        throw loginFailed(`This home isn't signed in to ${server}.`);
      }
      if (connection.binding.session) return connection.binding.session;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          connection.binding.ready(),
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new RpcError(
                    createDiagnostic("MOSTRA_REMOTE_UNREACHABLE", {
                      message: `${server} can't be reached now${connection.lastError ? `: ${connection.lastError}` : ""}.`,
                    }),
                  ),
                ),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    connected(server) {
      return connections.get(server)?.binding.session !== undefined;
    },
    status: () => status(),
    liveInterest: () => relay.liveInterest(),
    forwardLive: (artifactId, versionId, produced) => {
      const server = self.hostedOn(artifactId);
      if (server === undefined) return false;
      const connection = connections.get(server);
      relay.sendLive(
        server,
        () => (connection ? (connection.binding.session ?? readySoon(connection)) : undefined),
        artifactId,
        versionId,
        produced,
      );
      return true;
    },
    hostedOn: (artifactId) =>
      ledger.read(
        (db) =>
          db.get<{ server: string }>(
            "SELECT server FROM hosted_artifact WHERE artifact_id = ? AND stopped_at IS NULL AND route_id != '' ORDER BY shared_at LIMIT 1",
            artifactId,
          )?.server,
      ),
    forward: async (server, definition, params) => {
      let session: BindingSession;
      try {
        session = await self.session(server, 3000);
      } catch (error) {
        if (error instanceof RpcError) throw error;
        throw new RpcError(
          createDiagnostic("MOSTRA_REMOTE_UNREACHABLE", {
            message: `${server} can't be reached now; the hosted artifact's state lives there, so nothing was written.`,
          }),
        );
      }
      return session.call(definition, params, { timeoutMs: 30_000 });
    },
    shares: () => ({
      mint: async (input) => {
        const server = resolveServer(input.server);
        await self.host(input.artifactId, server);
        const session = await self.session(server);
        const minted = await session.call(viewUrlMethod, {
          artifact: { artifactId: input.artifactId },
          ...(input.scopes !== undefined ? { scopes: input.scopes } : {}),
          ...(input.ttl !== undefined ? { ttl: input.ttl } : {}),
          ...(input.viewer !== undefined ? { viewer: input.viewer } : {}),
        });
        protectLink(minted.url);
        writeLinks(server, { ...readLinks(server), [minted.tokenId]: minted.url });
        return {
          server,
          url: minted.url,
          tokenId: minted.tokenId,
          hostname: new URL(minted.url).host,
          ...(minted.expiresAt !== undefined ? { expiresAt: minted.expiresAt } : {}),
        };
      },
      url: (server, tokenId) => readLinks(server)[tokenId],
      revoke: async (server, tokenId) => {
        const session = await self.session(server);
        await session.call(viewRevokeMethod, { tokenId });
        const links = readLinks(server);
        delete links[tokenId];
        writeLinks(server, links);
      },
    }),
  };
  return self;
}
