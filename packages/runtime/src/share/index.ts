/**
 * Shares (HY-04, HY-05, D158): an artifact opened to viewers beyond this machine through a tunnel
 * the instance drives. A share opens the gateway's faces for its tunnel (D158 item 1), the tunnel
 * tool's processes that forward to them, and a link of its own at the tunnel's shell address
 * (D97 item 10); it ends at its TTL, on `share/stop`, when its link is revoked, or when its tunnel
 * can't continue, and every end revokes its link and stops what only it used.
 *
 * - **Tailnet** (Tailscale Serve): the shell's and each artifact's face keep leased ports, served
 *   on the device's name at the same port numbers, so tailnet links survive restarts. Requests
 *   carry the tailnet person, who becomes the viewer (D158 item 2).
 * - **Funnel**: the shell on 443 and two artifacts on 8443 and 10000 (D158 item 4), public.
 * - **Cloudflare** quick tunnels: one per face, each a site of its own, so worker-mode frames
 *   (D70), and pages long-poll, since quick tunnels hold responses back. A quick tunnel's address
 *   dies with its process, so its share ends with it, a restart included.
 *
 * ```ts
 * const shares = createShares({ ledger, log, gateway, capabilities, interaction, artifacts, … });
 * const share = await shares.start({ artifact: { artifactId }, via: "cloudflare", ttl: "1h" });
 * share.url; // https://<random>.trycloudflare.com/a/art_…#t=…
 * ```
 */
import { join } from "node:path";
import {
  type ArtifactDetail,
  type ArtifactRef,
  createDiagnostic,
  durationMs,
  PUBLIC_SHARE_DEFAULT_TTL,
  PUBLIC_SHARE_MAX_TTL_MS,
  RpcError,
  type Share,
  ShareId,
  type ShareListParams,
  type ShareStartParams,
  type ShareStartResult,
  type ShareStopParams,
  type ShareVia,
  shareListMethod,
  shareStartMethod,
  shareStopMethod,
} from "@mostra/protocol";
import type { Capabilities, FaceHandle, FaceSpec, Gateway } from "../gateway/index.ts";
import { faceKey } from "../gateway/index.ts";
import { appendEvent, type Interaction } from "../interaction/index.ts";
import {
  InflightRequests,
  type Ledger,
  type LedgerDb,
  recordedResult,
  recordResult,
  requestKey,
} from "../ledger/index.ts";
import type { Environment, Log } from "../log.ts";
import type { ProcessManager } from "../processes/index.ts";
import { handler, type MethodHandler } from "../protocol-server/index.ts";
import { hostnameResolves, quickTunnel } from "./cloudflare.ts";
import {
  expose,
  FUNNEL_ARTIFACT_PORTS,
  FUNNEL_SHELL_PORT,
  type TailnetDevice,
  tailnetDevice,
} from "./tailscale.ts";
import type { Tunnel } from "./tunnel.ts";

/** How often active shares are checked for an expired or revoked link. */
const SWEEP_MS = 30_000;

/** How a tailnet or Funnel tunnel that ended by itself is set up again: after 1, 4 and 16 s. */
const RESTART_DELAYS_MS: readonly number[] = [1_000, 4_000, 16_000];

/** How long a restart keeps trying to set a share up again before ending it (Tailscale starting). */
const RECOVERY_DELAYS_MS: readonly number[] = [0, 5_000, 15_000, 30_000, 60_000];

/** How long a quick tunnel's name may take to appear before its link is handed out anyway. */
const PROBE_MS = 30_000;

/** Options for {@link createShares}. */
export interface SharesOptions {
  readonly ledger: Ledger;
  readonly log: Log;
  readonly gateway: Gateway;
  readonly capabilities: Capabilities;
  readonly interaction: Interaction;
  readonly artifacts: { get(ref: ArtifactRef): ArtifactDetail };
  readonly processes: ProcessManager;
  /** Where the tools are looked up (`PATH`, `MOSTRA_TAILSCALE`, `MOSTRA_CLOUDFLARED`). */
  readonly environment: Environment;
  /** The tools' own environment: the artifact allowlist (proxies, certificates, `PATH`). */
  readonly toolEnvironment: Environment;
  /** The home's cache, for the quick tunnel's empty configuration. */
  readonly cacheDir: string;
  /** The clock, in milliseconds. */
  readonly now: () => number;
  /** How long a public address is probed before its link goes out; 0 turns probing off (tests). */
  readonly probeMs?: number;
}

/** The shares of one instance. */
export interface Shares {
  /** `share/start`, `share/stop` and `share/list`. */
  methods(): MethodHandler[];
  /** How many shares are active: each keeps a daemon from its idle exit (D133). */
  count(): number;
  /** The active shares, for `instance/status`. */
  active(): Share[];
  /** Sets tailnet and Funnel shares up again after a restart, and ends what can't continue. */
  recover(): Promise<void>;
  /** Stops every tunnel; shares stay active in the ledger, for the next start to set up again. */
  close(): Promise<void>;
}

interface ShareRow {
  id: string;
  artifact_id: string;
  via: ShareVia;
  hostname: string;
  token_id: string;
  mode: "cookie" | "worker";
  plan_json: string;
  started_at: string;
  expires_at: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
}

/** One face a share uses, as its plan records it. */
interface PlannedFace {
  readonly key: string;
  readonly listener: "shell" | "artifact";
  /** The tunnel's external port (Tailscale), or none (Cloudflare). */
  readonly external?: number;
}

interface Plan {
  readonly faces: readonly PlannedFace[];
}

/** A running tunnel and the shares that use it. */
interface Exposure {
  tunnel: Tunnel;
  readonly refs: Set<string>;
  readonly start: () => Promise<Tunnel>;
  readonly via: ShareVia;
  restarting: boolean;
}

/** Creates the shares of one instance. */
export function createShares(options: SharesOptions): Shares {
  const { ledger, log, gateway, capabilities, interaction } = options;
  const exposures = new Map<string, Exposure>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const inflight = new InflightRequests();
  let closed = false;
  let chain: Promise<unknown> = Promise.resolve();
  /** Share starts and stops run one at a time, so refcounts and port plans never race. */
  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
  };
  const toolContext = {
    processes: options.processes,
    log,
    env: { ...options.toolEnvironment, ...pick(options.environment) },
  };
  const iso = (ms: number): string => new Date(ms).toISOString();

  const row = (shareId: string): ShareRow | undefined =>
    ledger.read((db) => db.get<ShareRow>("SELECT * FROM share WHERE id = ?", shareId));

  const toShare = (found: ShareRow): Share => {
    const url = found.stopped_at === null ? gateway.reveal(found.token_id) : undefined;
    const artifactKey = (JSON.parse(found.plan_json) as Plan).faces.find(
      (face) => face.listener === "artifact",
    )?.key;
    const artifactOrigin =
      found.stopped_at === null && artifactKey !== undefined
        ? gateway.face(artifactKey)?.origin()
        : undefined;
    return {
      shareId: found.id,
      artifactId: found.artifact_id,
      via: found.via,
      ...(url !== undefined ? { url } : {}),
      hostname: found.hostname,
      ...(artifactOrigin !== undefined ? { artifactOrigin } : {}),
      mode: found.mode,
      tokenId: found.token_id,
      startedAt: found.started_at,
      ...(found.expires_at !== null ? { expiresAt: found.expires_at } : {}),
      state: found.stopped_at === null ? "active" : "stopped",
      ...(found.stopped_at !== null ? { stoppedAt: found.stopped_at } : {}),
      ...(found.stop_reason !== null ? { stopReason: found.stop_reason } : {}),
    };
  };

  const activeRows = (): ShareRow[] =>
    ledger.read((db) =>
      db.all<ShareRow>("SELECT * FROM share WHERE stopped_at IS NULL ORDER BY started_at DESC"),
    );

  // ── Tunnels ──────────────────────────────────────────────────────────────────────────────

  /**
   * The tunnel of a face, started for `shareId` or joined when it runs already. A tunnel that
   * ends by itself is set up again (Tailscale, whose address is the device's) or ends every share
   * that used it (Cloudflare, whose address died with it).
   */
  const acquire = async (
    key: string,
    shareId: string,
    via: ShareVia,
    start: () => Promise<Tunnel>,
  ): Promise<Tunnel> => {
    const running = exposures.get(key);
    if (running) {
      running.refs.add(shareId);
      return running.tunnel;
    }
    const tunnel = await start();
    const exposure: Exposure = { tunnel, refs: new Set([shareId]), start, via, restarting: false };
    exposures.set(key, exposure);
    watch(key, exposure);
    return tunnel;
  };

  const watch = (key: string, exposure: Exposure): void => {
    const current = exposure.tunnel;
    void current.ended.then(async (end) => {
      if (closed || exposures.get(key) !== exposure || exposure.tunnel !== current) return;
      log.warn("share.tunnel_dropped", { key, code: end.code, lines: end.lines.slice(-3) });
      if (exposure.via !== "cloudflare") {
        exposure.restarting = true;
        for (const delay of RESTART_DELAYS_MS) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          if (closed || exposures.get(key) !== exposure) return;
          try {
            exposure.tunnel = await exposure.start();
            exposure.restarting = false;
            log.info("share.tunnel_restored", { key });
            watch(key, exposure);
            return;
          } catch (error) {
            log.warn("share.tunnel_restart_failed", { key, error: (error as Error).message });
          }
        }
      }
      // The tunnel can't continue: every share that used it ends, and says why.
      for (const shareId of [...exposure.refs]) {
        await serial(() => stop(shareId, "tunnel")).catch((error: unknown) =>
          log.error("share.stop_failed", { shareId, error }),
        );
      }
    });
  };

  /** Drops a share's hold on a face's tunnel, stopping it and closing the face when unused. */
  const release = async (key: string, shareId: string): Promise<void> => {
    const exposure = exposures.get(key);
    if (exposure) {
      exposure.refs.delete(shareId);
      if (exposure.refs.size > 0) return;
      exposures.delete(key);
      await exposure.tunnel.stop();
    }
    // A tailnet face keeps its lease, so the next tailnet share has the same address.
    await gateway.closeFace(key, !key.startsWith("tailnet:"));
  };

  // ── Starting ─────────────────────────────────────────────────────────────────────────────

  /** The ttl a share's link gets: public shares 1 hour by default and at most 7 days (D158). */
  const lifetime = (via: ShareVia, ttl: ShareStartParams["ttl"]): number | undefined => {
    if (via === "tailnet") return ttl === undefined ? undefined : durationMs(ttl);
    const ms = durationMs(ttl ?? PUBLIC_SHARE_DEFAULT_TTL);
    if (ms > PUBLIC_SHARE_MAX_TTL_MS) {
      throw new RpcError(
        createDiagnostic("MOSTRA_SHARE_TTL_INVALID", {
          message: `A public share lasts at most 7 days; ${ttl} is longer.`,
        }),
      );
    }
    return ms;
  };

  /** Opens a face and its tunnel for a share, or joins the ones that run already. */
  const faceFor = async (
    spec: FaceSpec,
    shareId: string,
    tunnel: (face: FaceHandle) => Promise<Tunnel>,
    held: string[],
  ): Promise<FaceHandle> => {
    const face = await gateway.openFace(spec);
    held.push(face.key);
    const running = await acquire(face.key, shareId, spec.by as ShareVia, () => tunnel(face));
    face.setOrigin(running.origin);
    return face;
  };

  /** Sets up a share's faces and tunnels; on failure releases what it took. */
  const setUp = async (
    shareId: string,
    artifactId: string,
    via: ShareVia,
    planned: Plan | undefined,
  ): Promise<{ shell: FaceHandle; artifact: FaceHandle; plan: Plan; hostname: string }> => {
    const held: string[] = [];
    try {
      if (via === "cloudflare") {
        const group = `cloudflare:${shareId}`;
        const context = { ...toolContext, cacheDir: options.cacheDir };
        const spec = (listener: "shell" | "artifact"): FaceSpec => ({
          by: "cloudflare",
          group,
          listener,
          ...(listener === "artifact" ? { artifactId, mode: "worker" as const } : {}),
          via: "token",
          lease: false,
          streams: false,
        });
        const [shell, artifact] = await Promise.all([
          faceFor(
            spec("shell"),
            shareId,
            (face) => quickTunnel(context, { local: face.local, ownerRef: face.key }),
            held,
          ),
          faceFor(
            spec("artifact"),
            shareId,
            (face) => quickTunnel(context, { local: face.local, ownerRef: face.key }),
            held,
          ),
        ]);
        await Promise.all([probe(shell.origin()), probe(artifact.origin())]);
        return {
          shell,
          artifact,
          plan: {
            faces: [
              { key: shell.key, listener: "shell" },
              { key: artifact.key, listener: "artifact" },
            ],
          },
          hostname: new URL(shell.origin() as string).hostname,
        };
      }
      const device = await tailnetDevice(toolContext);
      const ours = (port: number): boolean =>
        [...exposures.entries()].some(
          ([key, exposure]) => exposure.via !== "cloudflare" && planPort(key) === port,
        );
      const free = (port: number): boolean => !device.served.has(port) || ours(port);
      if (via === "tailnet") {
        const spec = (listener: "shell" | "artifact"): FaceSpec => ({
          by: "tailnet",
          group: "tailnet",
          listener,
          ...(listener === "artifact" ? { artifactId } : {}),
          via: "tailnet",
          lease: true,
        });
        const serveAt = (face: FaceHandle): Promise<Tunnel> => {
          if (!free(face.port)) throw portTaken(face.port, "Serve");
          return tailnetTunnel(device, "serve", face.port, face);
        };
        const shell = await faceFor(spec("shell"), shareId, serveAt, held);
        const artifact = await faceFor(spec("artifact"), shareId, serveAt, held);
        return {
          shell,
          artifact,
          plan: {
            faces: [
              { key: shell.key, listener: "shell", external: shell.port },
              { key: artifact.key, listener: "artifact", external: artifact.port },
            ],
          },
          hostname: device.hostname,
        };
      }
      // Funnel: the shell on 443, each artifact on one of the two other ports.
      const spec = (listener: "shell" | "artifact"): FaceSpec => ({
        by: "funnel",
        group: "funnel",
        listener,
        ...(listener === "artifact" ? { artifactId } : {}),
        via: "token",
        lease: false,
      });
      const shellKey = faceKey("funnel", "shell");
      if (!exposures.has(shellKey) && !free(FUNNEL_SHELL_PORT))
        throw portTaken(FUNNEL_SHELL_PORT, "Funnel");
      const shell = await faceFor(
        spec("shell"),
        shareId,
        (face) => tailnetTunnel(device, "funnel", FUNNEL_SHELL_PORT, face),
        held,
      );
      const artifactKey = faceKey("funnel", "artifact", artifactId);
      const plannedPort = planned?.faces.find((face) => face.key === artifactKey)?.external;
      const port =
        planPort(artifactKey) ??
        plannedPort ??
        FUNNEL_ARTIFACT_PORTS.find(
          (candidate) =>
            free(candidate) &&
            ![...exposures.keys()].some(
              (key) => key !== artifactKey && planPort(key) === candidate,
            ),
        );
      if (port === undefined) {
        throw new RpcError(
          createDiagnostic("MOSTRA_SHARE_PORTS_EXHAUSTED", {
            message: `Tailscale Funnel's ports for artifacts (${FUNNEL_ARTIFACT_PORTS.join(" and ")}) are in use: two artifacts are shared through Funnel already, or this device's own configuration uses them.`,
          }),
        );
      }
      const artifact = await faceFor(
        spec("artifact"),
        shareId,
        (face) => tailnetTunnel(device, "funnel", port, face),
        held,
      );
      return {
        shell,
        artifact,
        plan: {
          faces: [
            { key: shell.key, listener: "shell", external: FUNNEL_SHELL_PORT },
            { key: artifact.key, listener: "artifact", external: port },
          ],
        },
        hostname: device.hostname,
      };
    } catch (error) {
      for (const key of held) await release(key, shareId).catch(() => undefined);
      throw error;
    }
  };

  /** The external ports of running Tailscale tunnels, by face key. */
  const externalPorts = new Map<string, number>();
  const planPort = (key: string): number | undefined => externalPorts.get(key);

  const tailnetTunnel = async (
    device: TailnetDevice,
    feature: "serve" | "funnel",
    port: number,
    face: FaceHandle,
  ): Promise<Tunnel> => {
    const tunnel = await expose(toolContext, device, {
      feature,
      port,
      local: face.local,
      ownerRef: face.key,
    });
    externalPorts.set(face.key, port);
    return tunnel;
  };

  const portTaken = (port: number, feature: string): RpcError =>
    new RpcError(
      createDiagnostic("MOSTRA_SHARE_PORTS_EXHAUSTED", {
        message: `Port ${port} of this device is in use by its own Tailscale ${feature} configuration, which Mostra never takes over.`,
      }),
    );

  /**
   * Waits until a quick tunnel's name exists at Cloudflare's resolvers, so the link never meets a
   * cached miss on this machine or a viewer's phone; nothing here resolves it before then.
   */
  const probe = async (origin: string | undefined): Promise<void> => {
    const budget = options.probeMs ?? PROBE_MS;
    if (origin === undefined || budget <= 0) return;
    const hostname = new URL(origin).hostname;
    // Only a real quick tunnel's name is new to the world's resolvers.
    if (!hostname.endsWith(".trycloudflare.com")) return;
    if (!(await hostnameResolves(hostname, budget))) {
      log.warn("share.name_unresolved", { hostname, budgetMs: budget });
    }
  };

  const start = async (params: ShareStartParams): Promise<ShareStartResult> => {
    const detail = options.artifacts.get(params.artifact);
    if (!detail.latestVersion && detail.versions.length === 0) {
      throw new RpcError(
        createDiagnostic("MOSTRA_ARTIFACT_VERSION_NOT_FOUND", {
          message: `The artifact ${detail.id} has no published version to share.`,
        }),
      );
    }
    const key = requestKey("share/start", params);
    if (key !== undefined) {
      const replay = ledger.read((db) => recordedResult<{ shareId: string }>(db, key));
      const found = replay ? row(replay.shareId) : undefined;
      if (found) return withUrl(toShare(found));
    }
    const ttlMs = lifetime(params.via, params.ttl);
    const shareId = ShareId.create();
    const { shell, artifact, plan, hostname } = await setUp(
      shareId,
      detail.id,
      params.via,
      undefined,
    );
    const shellOrigin = shell.origin() as string;
    const startedAt = options.now();
    const record = (): ReturnType<typeof gateway.mintAt> =>
      ledger.write((db) => {
        const viewerId =
          params.viewer === undefined ? undefined : interaction.viewerForSpec(db, params.viewer);
        const link = gateway.mintAt(
          { artifactId: detail.id, shellOrigin, scopes: params.scopes, ttlMs, viewerId },
          db,
        );
        db.run(
          "INSERT INTO share (id, artifact_id, via, hostname, token_id, mode, plan_json, started_at, expires_at, stopped_at, stop_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)",
          shareId,
          detail.id,
          params.via,
          hostname,
          link.tokenId,
          params.via === "cloudflare" ? "worker" : "cookie",
          JSON.stringify(plan),
          iso(startedAt),
          link.expiresAt ?? null,
        );
        appendEvent(db, {
          artifactId: detail.id,
          type: "share.started",
          payload: { shareId, via: params.via, hostname, artifactOrigin: artifact.origin() },
        });
        if (key !== undefined) recordResult(db, key, { shareId });
        return link;
      });
    let minted: ReturnType<typeof gateway.mintAt>;
    try {
      minted = record();
    } catch (error) {
      // Nothing was recorded: what the share set up goes again.
      for (const face of plan.faces) await release(face.key, shareId).catch(() => undefined);
      throw error;
    }
    schedule(shareId, minted.expiresAt);
    log.info("share.started", { shareId, artifactId: detail.id, via: params.via, hostname });
    const started = row(shareId) as ShareRow;
    return { ...toShare(started), url: minted.url };
  };

  const withUrl = (share: Share): ShareStartResult => ({
    ...share,
    url: share.url ?? gateway.reveal(share.tokenId) ?? "",
  });

  // ── Ending ───────────────────────────────────────────────────────────────────────────────

  const schedule = (shareId: string, expiresAt: string | undefined): void => {
    if (expiresAt === undefined) return;
    const delay = Math.max(0, Date.parse(expiresAt) - options.now());
    // Timers past ~24.8 days overflow; the sweep ends those.
    if (delay > 2 ** 31 - 1) return;
    const timer = setTimeout(() => {
      timers.delete(shareId);
      void serial(() => stop(shareId, "expired")).catch((error: unknown) =>
        log.error("share.stop_failed", { shareId, error }),
      );
    }, delay);
    timer.unref?.();
    timers.set(shareId, timer);
  };

  /**
   * Ends a share once: its link is revoked (unless it expired or was revoked already), the
   * ledger records why, and its faces' tunnels stop when no other share uses them.
   */
  const stop = async (shareId: string, reason: string): Promise<Share | undefined> => {
    const found = row(shareId);
    if (!found || found.stopped_at !== null) return undefined;
    const at = options.now();
    ledger.write((db: LedgerDb) => {
      db.run(
        "UPDATE share SET stopped_at = ?, stop_reason = ? WHERE id = ?",
        iso(at),
        reason,
        shareId,
      );
      if (reason !== "expired" && reason !== "revoked") capabilities.revoke(found.token_id, db);
      appendEvent(db, {
        artifactId: found.artifact_id,
        type: "share.stopped",
        payload: { shareId, via: found.via, hostname: found.hostname, reason },
      });
    });
    const timer = timers.get(shareId);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(shareId);
    const plan = JSON.parse(found.plan_json) as Plan;
    for (const face of plan.faces) await release(face.key, shareId);
    log.info("share.stopped", { shareId, via: found.via, reason });
    return toShare(row(shareId) as ShareRow);
  };

  /** Ends shares whose link expired or was revoked since (`view/revoke` of a share's link). */
  const sweep = async (): Promise<void> => {
    for (const found of activeRows()) {
      const grant = capabilities.grant(found.token_id);
      if (grant?.live) continue;
      const expired = found.expires_at !== null && Date.parse(found.expires_at) <= options.now();
      await serial(() => stop(found.id, expired ? "expired" : "revoked"));
    }
  };
  const sweeper = setInterval(() => {
    void sweep().catch((error: unknown) => log.error("share.sweep_failed", { error }));
  }, SWEEP_MS);
  sweeper.unref?.();

  // ── After a restart ──────────────────────────────────────────────────────────────────────

  const restore = async (found: ShareRow): Promise<void> => {
    const plan = JSON.parse(found.plan_json) as Plan;
    let last: unknown;
    for (const delay of RECOVERY_DELAYS_MS) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      if (closed) return;
      const current = row(found.id);
      if (!current || current.stopped_at !== null) return;
      try {
        await serial(() => setUp(found.id, found.artifact_id, found.via, plan));
        schedule(found.id, found.expires_at ?? undefined);
        log.info("share.restored", { shareId: found.id, via: found.via });
        return;
      } catch (error) {
        last = error;
        log.warn("share.restore_failed", { shareId: found.id, error: (error as Error).message });
      }
    }
    log.warn("share.restore_gave_up", {
      shareId: found.id,
      error: last instanceof Error ? last.message : String(last),
    });
    await serial(() => stop(found.id, "tunnel"));
  };

  return {
    methods: () => [
      handler(shareStartMethod, (params) => {
        const key = requestKey("share/start", params);
        const run = (): Promise<ShareStartResult> => serial(() => start(params));
        return key === undefined ? run() : inflight.run(key, run);
      }),
      handler(shareStopMethod, (params: ShareStopParams) =>
        serial(async () => {
          if ((params.shareId === undefined) === (params.artifact === undefined)) {
            throw new RpcError(
              createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", {
                message: "share/stop names either `shareId` or `artifact`, not both or neither.",
              }),
              -32602,
            );
          }
          let ids: string[];
          if (params.shareId !== undefined) {
            if (!row(params.shareId)) {
              throw new RpcError(
                createDiagnostic("MOSTRA_SHARE_NOT_FOUND", {
                  message: `No share ${params.shareId} exists in this home.`,
                }),
              );
            }
            ids = [params.shareId];
          } else {
            const artifactId = options.artifacts.get(params.artifact as ArtifactRef).id;
            ids = activeRows()
              .filter((found) => found.artifact_id === artifactId)
              .map((found) => found.id);
          }
          const stopped: Share[] = [];
          for (const id of ids) {
            const ended = await stop(id, "stopped");
            if (ended) stopped.push(ended);
          }
          return { stopped };
        }),
      ),
      handler(shareListMethod, (params: ShareListParams) => {
        const artifactId =
          params.artifact === undefined ? undefined : options.artifacts.get(params.artifact).id;
        const rows = ledger.read((db) =>
          db.all<ShareRow>(
            params.all === true
              ? "SELECT * FROM share ORDER BY stopped_at IS NOT NULL, started_at DESC"
              : "SELECT * FROM share WHERE stopped_at IS NULL ORDER BY started_at DESC",
          ),
        );
        return {
          shares: rows
            .filter((found) => artifactId === undefined || found.artifact_id === artifactId)
            .map(toShare),
        };
      }),
    ],
    count: () =>
      ledger.read(
        (db) =>
          db.get<{ count: number }>("SELECT COUNT(*) AS count FROM share WHERE stopped_at IS NULL")
            ?.count ?? 0,
      ),
    active: () => activeRows().map(toShare),
    async recover() {
      const pending: Promise<void>[] = [];
      for (const found of activeRows()) {
        const grant = capabilities.grant(found.token_id);
        const expired = found.expires_at !== null && Date.parse(found.expires_at) <= options.now();
        if (expired || !grant?.live) {
          await serial(() => stop(found.id, expired ? "expired" : "revoked"));
        } else if (found.via === "cloudflare") {
          // A quick tunnel's address died with the instance that ran it.
          await serial(() => stop(found.id, "restart"));
        } else {
          pending.push(restore(found));
        }
      }
      await Promise.all(pending);
    },
    async close() {
      closed = true;
      clearInterval(sweeper);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      const running = [...exposures.values()];
      exposures.clear();
      await Promise.all(running.map((exposure) => exposure.tunnel.stop()));
    },
  };
}

/** The variables that name the tools outright, passed to the lookup from the instance's own. */
function pick(env: Environment): Environment {
  const out: Record<string, string> = {};
  // The test fakes (`MOSTRA_TEST_TUNNELS`) and what they are told to play.
  if (env["MOSTRA_TEST_TUNNELS"]) {
    for (const [name, value] of Object.entries(env)) {
      if (
        (name === "MOSTRA_TEST_TUNNELS" || name.startsWith("MOSTRA_FAKE_")) &&
        value !== undefined
      ) {
        out[name] = value;
      }
    }
  }
  for (const name of [
    "MOSTRA_TAILSCALE",
    "MOSTRA_CLOUDFLARED",
    "PATH",
    "Path",
    "ProgramFiles",
    "ProgramFiles(x86)",
  ]) {
    const value = env[name];
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/** The directory of a home's share files (the quick tunnel's empty configuration). */
export function shareCacheDir(home: string): string {
  return join(home, "cache", "share");
}
