/**
 * `mostra dev` (VR-08, D140 item 12): a development preview of an artifact's unpublished source,
 * with Vite's hot reload, its server code, live sources and submissions working, kept apart from
 * everything a viewer can reach.
 *
 * A session is a sandbox like a verify run's (D138 item 1): a scratch ledger in
 * `cache/dev/<session>/`, its own worker pool, and two loopback listeners on ports the operating
 * system picks, reached only with the link minted in that scratch ledger; the artifact origin's
 * files and HMR WebSocket come from a Vite server in a builder child, behind the gateway's checks.
 * The source is mirrored into the session's root (Mostra never writes into the artifact's
 * directory) and kept in step as it changes. Nothing reaches the home's drafts, state, events,
 * hosts or deliveries; submissions are reported to the session's connection with their Results.
 *
 * A session belongs to the connection that started it and ends with it (or `dev/stop`); open
 * sessions keep a daemon from its idle exit (D133). Recovery at start removes leftovers.
 */
import { createHash, randomBytes } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  ArtifactId,
  type ArtifactManifest,
  createDiagnostic,
  DEV_NOTIFY,
  type DevEventKind,
  type DevNotifyParams,
  type Diagnostic,
  devStartMethod,
  devStopMethod,
  RpcError,
  type SourceRef,
  VersionId,
} from "@mostra/protocol";
import type { DevChange, DevChild, DevServerBuild, RenderMode } from "../builder/index.ts";
import { type Dependencies, lockKey } from "../deps/index.ts";
import type { Gate } from "../gate.ts";
import type { Log } from "../log.ts";
import { handler, type MethodHandler, type Session } from "../protocol-server/index.ts";
import {
  extractManifest,
  listSource,
  type ResolvedSource,
  resolveSource,
} from "../publish/index.ts";
import type { Registry } from "../registry/index.ts";
import { type Sandbox, type SandboxOptions, startSandbox } from "../verify/index.ts";

/** How often the mirror is compared with the source, besides file-system events. */
const POLL_MS = 1000;
/** How long the source must be still before the mirror catches up. */
const SETTLE_MS = 60;

/** Options for {@link createDev}. */
export interface DevOptions {
  /** The home's real path. */
  readonly home: string;
  readonly log: Log;
  readonly registry: Registry;
  readonly renderMode: () => RenderMode;
  readonly dependencies: () => Dependencies;
  readonly gate: Gate;
  /** What a sandbox needs of the instance, as verify's. */
  readonly sandbox: () => SandboxOptions;
  /** The address the instance's gateway binds: dev refuses to run beside a non-loopback bind. */
  readonly bindAddress: string;
  /** Sends a notification to one connection; false when it couldn't. */
  readonly notify: (session: number, method: string, params: DevNotifyParams) => boolean;
}

/** The dev sessions of an instance. */
export interface Dev {
  methods(): MethodHandler[];
  /** How many sessions are open: each keeps a daemon from its idle exit. */
  count(): number;
  /** An artifact's dependencies changed (`deps/add`): its sessions resolve them again. */
  dependenciesChanged(artifact: SourceRef): void;
  stopAll(): Promise<void>;
}

/** The directory every session lives in. */
export const devRoot = (home: string): string => join(home, "cache", "dev");

/** Removes the sessions a stopped instance left; call it before any session starts. */
export async function recoverDev(home: string, log: Log): Promise<void> {
  let left: string[];
  try {
    left = await readdir(devRoot(home));
  } catch {
    return;
  }
  for (const name of left) await rm(join(devRoot(home), name), { recursive: true, force: true });
  if (left.length > 0) log.info("dev.sessions_removed", { count: left.length });
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

interface Running {
  readonly id: string;
  readonly owner: number;
  readonly artifactId: string;
  readonly bindingPath: string;
  stop(): Promise<void>;
  resolveAgain(): void;
}

/** Creates the instance's dev sessions. */
export function createDev(options: DevOptions): Dev {
  const { log } = options;
  const sessions = new Map<string, Running>();

  const start = async (
    params: {
      readonly source: { readonly path: string } | { readonly artifactId: string };
      readonly port?: number;
    },
    connection: Session,
  ): Promise<{ url: string; port: number; sessionId: string }> => {
    if (!LOOPBACK.has(options.bindAddress)) {
      throw new RpcError(
        createDiagnostic("MOSTRA_ENV_BIND_FAILED", {
          message: `mostra dev serves only on loopback, and this instance binds ${options.bindAddress}.`,
          hint: "Run mostra dev against an instance started without --bind.",
        }),
      );
    }
    const path =
      "path" in params.source
        ? params.source.path
        : (options.registry.sourceOf(params.source.artifactId) ??
          (() => {
            throw new RpcError(
              createDiagnostic("MOSTRA_ARTIFACT_NOT_FOUND", {
                message: `No artifact ${params.source.artifactId} was published in this home; name it by its source path.`,
              }),
            );
          })());
    const source = await resolveSource(path);
    const sessionId = `dev_${ArtifactId.create().slice("art_".length)}`;
    const dir = join(devRoot(options.home), sessionId);
    const root = join(dir, "root");
    const versionDir = join(dir, "version");
    await mkdir(join(root, "source"), { recursive: true, mode: 0o700 });
    await mkdir(versionDir, { recursive: true });
    const secret = randomBytes(32).toString("base64url");
    const versionId = VersionId.fromSha256(
      new Uint8Array(createHash("sha256").update(`mostra dev ${sessionId}`).digest()),
    );
    const notify = (kind: DevEventKind, extra: Partial<DevNotifyParams> = {}): void => {
      options.notify(connection.id, DEV_NOTIFY, {
        sessionId,
        kind,
        at: new Date().toISOString(),
        ...extra,
      });
    };

    let closed = false;
    let child: DevChild | undefined;
    let sandbox: Sandbox | undefined;
    let watcher: FSWatcher | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let outputDigest = "";
    let nodeModules = "";
    let manifestKey = "";
    let artifactId = "";
    const mirrored = new Map<string, string>();

    /** Copies changed files into the mirror and removes deleted ones; what changed. */
    const sync = async (): Promise<DevChange[]> => {
      const files = await listSource(source);
      const changed: DevChange[] = [];
      const seen = new Set<string>();
      for (const file of files) {
        seen.add(file.path);
        let info: Awaited<ReturnType<typeof stat>>;
        try {
          info = await stat(file.absolute);
        } catch {
          continue;
        }
        const key = `${info.size}:${info.mtimeMs}:${info.ino}`;
        const before = mirrored.get(file.path);
        if (before === key) continue;
        const target = join(root, "source", ...file.path.split("/"));
        await mkdir(dirname(target), { recursive: true });
        await copyFile(file.absolute, target);
        mirrored.set(file.path, key);
        changed.push({ file: file.path, kind: before === undefined ? "add" : "change" });
      }
      for (const path of [...mirrored.keys()]) {
        if (seen.has(path)) continue;
        mirrored.delete(path);
        await unlink(join(root, "source", ...path.split("/"))).catch(() => {});
        changed.push({ file: path, kind: "unlink" });
      }
      return changed;
    };

    /** The manifest and identity of the mirrored source. */
    const describe = async (): Promise<{
      manifest: ArtifactManifest;
      artifactId: string;
      entryHasDefault: boolean;
      warnings: readonly Diagnostic[];
    }> => {
      const extracted = extractManifest(
        source.entry,
        await readFile(join(root, "source", source.entry), "utf8"),
      );
      const manifest = extracted.manifest ?? { title: titleOf(source) };
      const artifactId =
        manifest.id ??
        options.registry.artifactAt(source.bindingPath) ??
        stableId(source.bindingPath);
      return {
        manifest,
        artifactId,
        entryHasDefault: extracted.hasDefaultExport,
        warnings: extracted.warnings,
      };
    };

    /** Resolves the packages, and writes the lockfile the worker resolves server packages by. */
    const resolve = async (manifestId: string | undefined): Promise<string> => {
      const resolution = await options.gate.shared(() =>
        options.dependencies().resolve({
          key: lockKey(
            manifestId ?? options.registry.artifactAt(source.bindingPath),
            source.bindingPath,
          ),
          sourceDir: join(root, "source"),
          artifactDir: source.root,
          artifactPath: path,
        }),
      );
      await writeFile(join(versionDir, "lock.yaml"), resolution.lock);
      return resolution.nodeModules;
    };

    /** Writes the dev version's manifest with a new output digest for its new server bundle. */
    const writeVersion = async (
      manifest: ArtifactManifest,
      artifactId: string,
      server: boolean,
    ): Promise<void> => {
      outputDigest = createHash("sha256")
        .update(`${sessionId}:${Date.now()}:${randomBytes(8).toString("hex")}`)
        .digest("hex");
      await writeFile(
        join(versionDir, "manifest.json"),
        `${JSON.stringify({ schemaVersion: 1, artifactId, versionId, mode: "spa", entry: source.entry, server, manifest, outputDigest, forcedCodes: [], dev: true }, null, 2)}\n`,
      );
    };

    const reported = (build: DevServerBuild): void => {
      if (!build.ok) notify("diagnostics", { diagnostics: build.diagnostics });
    };

    /** Starts (or restarts) the dev child over the current mirror. */
    const startChild = async (
      described: Awaited<ReturnType<typeof describe>>,
    ): Promise<DevChild> => {
      const started = await options.renderMode().dev(
        {
          root,
          entry: source.entry,
          entryHasDefault: described.entryHasDefault,
          manifest: described.manifest,
          versionId,
          nodeModules,
          outDir: versionDir,
          secret,
        },
        {
          server: (build, files) => {
            void (async () => {
              if (build.ok) {
                await writeVersion(described.manifest, described.artifactId, build.server);
                await sandbox?.replaceServer();
                await child?.reload().catch(() => {});
                notify("server-restarted", { files });
              } else reported(build);
            })().catch((error: unknown) => log.warn("dev.server_reload_failed", { error }));
          },
          update: (files) => notify("built", { files }),
        },
      );
      void started.exited.then(() => {
        if (!closed && child === started) {
          log.warn("dev.child_exited", { sessionId });
          notify("diagnostics", {
            diagnostics: [
              createDiagnostic("MOSTRA_BUILD_CRASHED", { message: "The dev server stopped." }),
            ],
          });
        }
      });
      if (started.ready.build.ok)
        await writeVersion(described.manifest, described.artifactId, started.ready.build.server);
      else reported(started.ready.build);
      return started;
    };

    /** Catches the mirror up; resolves packages again and restarts the dev server when they or
     * the manifest changed. */
    let catching: Promise<void> = Promise.resolve();
    const catchUp = (forceResolve = false): void => {
      catching = catching
        .then(async () => {
          if (closed) return;
          const changed = await sync();
          if (changed.length === 0 && !forceResolve) return;
          const described = await describe();
          const key = JSON.stringify(described.manifest);
          const next = await resolve(described.manifest.id).catch((error: unknown) => {
            if (error instanceof RpcError)
              notify("diagnostics", { diagnostics: [error.diagnostic] });
            return nodeModules;
          });
          const files = changed.map((change) => change.file);
          if (next !== nodeModules || key !== manifestKey) {
            // Other packages or another manifest: a new dev server over the same mirror, its
            // server bundle in the worker, and every page loaded again (D140 item 12).
            nodeModules = next;
            manifestKey = key;
            const old = child;
            child = await startChild(described);
            await old?.stop();
            await sandbox?.replaceServer();
            notify("reloaded", { files });
          } else if (changed.length > 0) {
            await child?.changed(changed);
          }
        })
        .catch((error: unknown) => log.warn("dev.sync_failed", { sessionId, error }));
    };

    /** Releases everything the session holds; safe to run again, and while it still starts. */
    const release = async (): Promise<void> => {
      clearInterval(poll);
      clearTimeout(settleTimer);
      watcher?.close();
      await catching.catch(() => {});
      await child?.stop().catch(() => {});
      await sandbox?.close().catch(() => {});
      await rm(dir, { recursive: true, force: true });
    };
    const stop = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      sessions.delete(sessionId);
      await release();
      log.info("dev.stopped", { sessionId });
    };
    /** The connection that started the session closed while it started: nothing may outlive it. */
    const abandoned = (): RpcError =>
      new RpcError(
        createDiagnostic("MOSTRA_HOST_CONNECTION_CLOSED", {
          message: "The connection that started this dev session closed while it started.",
        }),
      );

    // The session ends with its connection (D140 item 12), from the first moment: a connection
    // that closes while packages resolve or the dev server starts leaves nothing running.
    connection.signal.addEventListener("abort", () => void stop(), { once: true });
    try {
      if (connection.signal.aborted) throw abandoned();
      await sync();
      const described = await describe();
      manifestKey = JSON.stringify(described.manifest);
      nodeModules = await resolve(described.manifest.id);
      artifactId = described.artifactId;
      child = await startChild(described);
      if (closed) throw abandoned();
      const upstream = (): { port: number; secret: string } | undefined =>
        child ? { port: child.ready.port, secret } : undefined;
      sandbox = await startSandbox(options.sandbox(), {
        artifactId: described.artifactId,
        versions: [
          {
            versionId,
            dir: versionDir,
            manifest: described.manifest,
            sourceDigest: "0".repeat(64),
            envDigest: "0".repeat(64),
            get outputDigest() {
              return outputDigest;
            },
          },
        ],
        sourceDir: source.root,
        runDir: join(dir, "sandbox"),
        dev: { upstream },
        ...(params.port !== undefined ? { shellPort: params.port } : {}),
      });
      if (closed) throw abandoned();
      sandbox.onSubmission((results) => notify("submission", { results }));
    } catch (error) {
      closed = true;
      sessions.delete(sessionId);
      // Again, after whatever a stop that ran meanwhile couldn't see yet (a child or sandbox
      // that finished starting after it).
      await release();
      throw error;
    }

    // Keep the mirror in step: file-system events when the platform gives them, a poll anyway.
    try {
      watcher = watch(source.kind === "dir" ? source.root : join(source.root, source.entry), {
        recursive: source.kind === "dir",
        persistent: false,
      });
      watcher.on("change", () => {
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => catchUp(), SETTLE_MS);
      });
      watcher.on("error", () => watcher?.close());
    } catch {
      watcher = undefined;
    }
    poll = setInterval(() => catchUp(), POLL_MS);
    poll.unref();

    sessions.set(sessionId, {
      id: sessionId,
      owner: connection.id,
      artifactId,
      bindingPath: source.bindingPath,
      stop,
      resolveAgain: () => catchUp(true),
    });
    const url = sandbox.link(versionId);
    log.info("dev.started", { sessionId, artifactId });
    notify("built");
    return { url, port: Number(new URL(url).port), sessionId };
  };

  return {
    methods: () => [
      handler(devStartMethod, (params, session) => start(params, session)),
      handler(devStopMethod, async (params, session) => {
        const running = sessions.get(params.sessionId);
        if (!running || running.owner !== session.id) {
          throw new RpcError(
            createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", {
              message: `This connection has no dev session ${params.sessionId}.`,
            }),
          );
        }
        await running.stop();
        return {};
      }),
    ],
    count: () => sessions.size,
    dependenciesChanged: (artifact) => {
      void (async () => {
        const bindingPath =
          "path" in artifact
            ? (await resolveSource(artifact.path).catch(() => undefined))?.bindingPath
            : undefined;
        for (const running of sessions.values()) {
          const same =
            "artifactId" in artifact
              ? running.artifactId === artifact.artifactId
              : running.bindingPath === bindingPath;
          if (same) running.resolveAgain();
        }
      })();
    },
    stopAll: async () => {
      await Promise.all([...sessions.values()].map((running) => running.stop()));
    },
  };
}

/** The title of a source without a manifest: its directory's or file's name (INTERFACES §2.2). */
function titleOf(source: ResolvedSource): string {
  const name =
    source.kind === "dir" ? source.root.split("/").at(-1) : source.entry.replace(/\.[^.]+$/, "");
  return name || "Untitled";
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A stand-in artifact ID for a source no manifest `id` or binding names: stable per path. */
function stableId(bindingPath: string): string {
  const hash = createHash("sha256").update(`mostra dev provisional\u0000${bindingPath}`).digest();
  let body = CROCKFORD[(hash[0] as number) % 8] as string;
  for (let index = 1; index < 26; index += 1) body += CROCKFORD[(hash[index] as number) % 32];
  return ArtifactId.parse(`art_${body}`);
}
