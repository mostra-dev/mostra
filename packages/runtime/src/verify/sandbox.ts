/**
 * A verify run's sandbox (D138 item 1): the real interaction, actions, live and gateway code over
 * a scratch ledger in `cache/verify/runs/<run>/`, with its own worker pool and two short-lived
 * loopback listeners on ports the operating system assigns, so a run never touches the home's
 * drafts, state, events, hosts or deliveries, and the human-facing gateway never serves an
 * unpublished build.
 *
 * - Pages are reached only with capability links minted in the scratch ledger, through the same
 *   session exchange and frame tickets as a viewer's (D97, D98). Documents get the verify target
 *   when served (`target: "verify"`), never in the build.
 * - Server code runs in workers the gated process manager starts. A function that opted into
 *   `dryRun()` runs with it true; any other is refused before anything is recorded (D55).
 * - `secret()` reads the real secrets, as the instance resolves them; nothing else of the home is
 *   reached. State starts empty, like a first view.
 * - Closing stops everything and deletes the run's directory; {@link recoverSandboxes} removes
 *   what a stopped instance left.
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { type ArtifactManifest, type Results, RunId } from "@mostra/protocol";
import { createActions } from "../actions/index.ts";
import { createAddressing } from "../addressing/index.ts";
import {
  coverageMatcher,
  readFieldCoverage,
  readLiveSources,
  readServerFunctions,
} from "../builder/index.ts";
import { noFaults } from "../faults.ts";
import { Capabilities, createGateway, type DevUpstream } from "../gateway/index.ts";
import { createEphemeralBus, createInteraction } from "../interaction/index.ts";
import { openLedger } from "../ledger/index.ts";
import { createLive } from "../live/index.ts";
import type { Environment, Log, Redactor } from "../log.ts";
import type { ProcessManager } from "../processes/index.ts";
import { openRegistry } from "../registry/index.ts";
import type { Secrets } from "../secrets/index.ts";
import {
  createWorkerPool,
  localLauncher,
  type WorkerVersion,
  workerLimits,
} from "../workers/index.ts";

/** One version the sandbox serves. */
export interface SandboxVersion {
  readonly versionId: string;
  /** Its directory: a verify build in `cache/builds/` or a published version in `versions/`. */
  readonly dir: string;
  readonly manifest: ArtifactManifest;
  readonly sourceDigest: string;
  readonly envDigest: string;
  readonly outputDigest: string;
}

/** What the sandbox needs of its instance. */
export interface SandboxOptions {
  /** The home's real path. */
  readonly home: string;
  readonly log: Log;
  readonly redactor: Redactor;
  readonly processes: ProcessManager;
  readonly runtimeVersion: string;
  /** The worker's entry and Node arguments (`locateWorker`). */
  readonly worker: { readonly entry: string; readonly nodeArgs: readonly string[] };
  /** A version's packages for its server code (`Dependencies.runtimeModules`, D135). */
  readonly modules: (target: {
    readonly artifactId: string;
    readonly versionDir: string;
    readonly sourceDir?: string;
  }) => Promise<string>;
  /** The real secrets, read-only from server code (D138 item 1). */
  readonly secrets: Secrets;
  /** The artifact allowlist environment every worker gets (D95). */
  readonly env: Environment;
  /** The shell's built files. */
  readonly shellDir: string | undefined;
  readonly revisions: readonly string[];
  /** The render mode's server bundle of a version directory (D19 seam 5). */
  readonly serverEntry: (dir: string) => string | undefined;
  /** What is wrong with a version directory's files, or `undefined`. */
  readonly damage: (dir: string) => Promise<string | undefined>;
}

/** A running sandbox. */
export interface Sandbox {
  /** A fresh capability link to a version the sandbox serves: one per render, like a viewer's. */
  link(versionId: string): string;
  /** The shell's origin, for the health check. */
  readonly shellOrigin: string;
  /** The server functions it refused, in order (D55). */
  readonly skipped: ReadonlySet<string>;
  /** The live sources whose producers failed, with their messages. */
  liveFailures(): { readonly key: string; readonly message: string; readonly code?: string }[];
  /**
   * The workers that crashed, couldn't start, ran out of memory or hung, by version: a definite
   * failure of server code even when the page handled the failed call (Opus review finding 4).
   */
  crashes(): readonly {
    readonly versionId: string;
    readonly kind: string;
    readonly cause: string;
  }[];
  /**
   * `mostra dev` only (D140 item 12): the candidate's server bundle changed in place; its worker
   * stops so the next call loads the new bundle.
   */
  replaceServer(): Promise<void>;
  /** Hears every submission made in the sandbox, with its Results (D140 item 12). */
  onSubmission(listener: (results: Results) => void): () => void;
  /** Stops everything and deletes the run's directory. */
  close(): Promise<void>;
}

/** The directory every run's sandbox lives in. */
export const sandboxRoot = (home: string): string => join(home, "cache", "verify", "runs");

/** Removes the sandboxes a stopped instance left (D138 item 1); call it before any run starts. */
export async function recoverSandboxes(home: string, log: Log): Promise<void> {
  const root = sandboxRoot(home);
  let left: string[];
  try {
    left = await readdir(root);
  } catch {
    return;
  }
  for (const name of left) await rm(join(root, name), { recursive: true, force: true });
  if (left.length > 0) log.info("verify.sandboxes_removed", { count: left.length });
}

/** The server functions of a version that check `dryRun()` (`registry.json`, D55). */
export function dryRunFunctions(dir: string): ReadonlySet<string> {
  try {
    const registry = JSON.parse(readFileSync(join(dir, "registry.json"), "utf8")) as {
      readonly actions?: readonly { readonly id?: unknown; readonly dryRun?: unknown }[];
    };
    return new Set(
      (registry.actions ?? [])
        .filter((entry) => entry.dryRun === true && typeof entry.id === "string")
        .map((entry) => entry.id as string),
    );
  } catch {
    return new Set();
  }
}

/**
 * Starts a sandbox serving `versions` of `artifactId` (the baseline first, if any, then the
 * candidate), whose server code runs from `sourceDir` when it exists.
 */
export async function startSandbox(
  options: SandboxOptions,
  input: {
    readonly artifactId: string;
    readonly versions: readonly SandboxVersion[];
    readonly sourceDir?: string;
    /** The run's directory; default a new one in {@link sandboxRoot}. */
    readonly runDir?: string;
    /**
     * A `mostra dev` session's sandbox (D140 item 12) instead of a verify run's: the artifact
     * origin serves the session's Vite server (`upstream`), pages run as live pages, and actions
     * run for real with the real secrets. Nothing is delivered to hosts or ports either way.
     */
    readonly dev?: { readonly upstream: () => DevUpstream | undefined };
    /** The shell's port, instead of one the operating system assigns (`mostra dev --port`). */
    readonly shellPort?: number;
  },
): Promise<Sandbox> {
  const { log } = options;
  const runDir = input.runDir ?? join(sandboxRoot(options.home), RunId.create());
  await mkdir(runDir, { recursive: true, mode: 0o700 });
  const opening = openLedger({
    storeDir: join(runDir, "store"),
    runtimeVersion: options.runtimeVersion,
    owner: { pid: process.pid, startTime: `verify-${Date.now()}` },
    log,
  });
  if (!opening.ok) throw new Error("A verify sandbox's scratch ledger was locked.");
  const ledger = opening.ledger;
  // Stops run last-pushed first: everything else, then the ledger, then the directory, so the
  // scratch ledger closes (and checkpoints) before its files are removed.
  const stops: (() => Promise<void> | void)[] = [
    () => rm(runDir, { recursive: true, force: true }),
    () => ledger.close(),
  ];
  const close = async (): Promise<void> => {
    for (const stop of stops.splice(0).reverse()) {
      try {
        await stop();
      } catch (error) {
        log.warn("verify.sandbox_stop_failed", { error });
      }
    }
  };
  try {
    const registry = await openRegistry({ home: runDir, ledger });
    const dirs = new Map<string, string>();
    const numbers = new Map<string, number>();
    for (const version of input.versions) {
      dirs.set(version.versionId, version.dir);
      const committed = registry.commit({
        artifactId: input.artifactId,
        bindingPath: `verify:${input.artifactId}`,
        manifestId: undefined,
        versionId: version.versionId,
        sourceDigest: version.sourceDigest,
        envDigest: version.envDigest,
        outputDigest: version.outputDigest,
        manifest: version.manifest,
        policy: undefined,
        forcedCodes: [],
        stillClaims: () => false,
      });
      numbers.set(version.versionId, committed.version);
    }
    const dirOf = (versionId: string): string => {
      const dir = dirs.get(versionId);
      if (!dir) throw new Error(`The verify sandbox serves no version ${versionId}.`);
      return dir;
    };
    const candidate = input.versions.at(-1);
    if (!candidate) throw new Error("A verify sandbox needs a version.");

    const addressing = createAddressing({
      ledger,
      log,
      bind: { address: "127.0.0.1" },
      ephemeral: true,
      ...(input.shellPort !== undefined ? { shellPort: input.shellPort } : {}),
    });
    const capabilities = new Capabilities({
      ledger,
      log,
      key: randomBytes(32),
      now: () => Date.now(),
      shellOrigin: () => gateway.shellOrigin(),
    });
    const interaction = createInteraction({
      ledger,
      log,
      faults: noFaults,
      // No host is reached from a sandbox: nothing is delivered, mirrored or asked (D138 item 1).
      hosts: {
        registrants: () => [],
        call: () => Promise.reject(new Error("A verify sandbox calls no host.")),
        notify: () => false,
        drained: () => undefined,
      },
      expectedHosts: () => [],
      artifacts: { resolve: (ref) => registry.get(ref).id },
      coverage: (versionId) => coverageMatcher(readFieldCoverage(dirOf(versionId))),
    });
    stops.push(() => interaction.stop());
    const bus = createEphemeralBus();
    stops.push(() => bus.close());

    const optIns = new Map<string, ReadonlySet<string>>();
    const skipped = new Set<string>();
    const crashes: { versionId: string; kind: string; cause: string }[] = [];
    const workerVersion = (versionId: string): WorkerVersion | undefined => {
      const dir = dirs.get(versionId);
      const version = input.versions.find((entry) => entry.versionId === versionId);
      const served = dir ? options.serverEntry(dir) : undefined;
      if (!dir || !version || served === undefined) return undefined;
      return {
        artifactId: input.artifactId,
        ref: {
          versionId,
          outputDigest: version.outputDigest,
          locator: `home:${relative(options.home, dir)}`,
        },
        entry: relative(dir, served),
        limits: workerLimits(version.manifest),
        functions: readServerFunctions(dir),
        ...(input.sourceDir ? { sourceDir: input.sourceDir } : {}),
      };
    };
    const pool = createWorkerPool({
      launcher: localLauncher({
        processes: options.processes,
        home: options.home,
        workerEntry: options.worker.entry,
        nodeArgs: options.worker.nodeArgs,
        modules: options.modules,
      }),
      log,
      env: options.env,
      bridge: {
        request: (worker, method, params, call) =>
          actions.bridge.request(worker, method, params, call),
        log: (worker, line) => actions.bridge.log(worker, line),
        liveValue: (worker, params) => live.produced(worker, params),
      },
      onCrash: (crash) => {
        if (crashes.length < 20)
          crashes.push({ versionId: crash.versionId, kind: crash.kind, cause: crash.cause });
        actions.crashed(crash);
        live.crashed(crash);
        interaction.workerCrashed(crash);
      },
    });
    stops.push(() => pool.stopAll());
    const actions = createActions({
      interaction,
      pool,
      bus,
      secrets: options.secrets,
      redactor: options.redactor,
      log,
      version: workerVersion,
      // In dev, the developer's own code runs for real on their own machine, as any dev server's
      // does (D140 item 12); in verify, only what opted into dryRun() runs (D55).
      ...(input.dev
        ? {}
        : {
            dryRun: {
              optedIn: (versionId: string, fnId: string) => {
                let opted = optIns.get(versionId);
                if (!opted) {
                  opted = dryRunFunctions(dirOf(versionId));
                  optIns.set(versionId, opted);
                }
                return opted.has(fnId);
              },
              skipped: (fnId: string) => {
                skipped.add(fnId);
              },
            },
          }),
    });
    // A dev session's server code builds again, and its sources with it (D140 item 12).
    let sources = readLiveSources(candidate.dir);
    const live = createLive({
      ledger,
      log,
      bus,
      pool,
      interaction,
      // Every render of the run reads the candidate's producers, so the baseline and the
      // candidate show the same data (D138 item 4).
      latest: (artifactId) =>
        artifactId === input.artifactId && sources.length > 0
          ? { versionId: candidate.versionId, sources }
          : undefined,
      artifactsWithLive: () => (sources.length > 0 ? [input.artifactId] : []),
      version: workerVersion,
      redactor: options.redactor,
    });
    stops.push(() => live.stop());

    const gateway = createGateway({
      ledger,
      log,
      addressing,
      capabilities,
      artifacts: {
        get: (ref) => registry.get(ref),
        versionDir: dirOf,
        damage: (versionId) => options.damage(dirOf(versionId)),
      },
      shellDir: options.shellDir,
      interaction,
      // Both channels, every control: the page behaves as it would for a viewer of the standalone
      // host, and the artifact's own Submit is exercised in the sandbox.
      controls: async () => ({ submitChannels: ["shell", "artifact"] }),
      activated: () => undefined,
      revisions: options.revisions,
      actions,
      live,
      bus,
      parked: () => false,
      ...(input.dev ? { target: "live" as const, dev: input.dev } : { target: "verify" as const }),
    });
    await gateway.start();
    stops.push(() => gateway.close());

    return {
      shellOrigin: gateway.shellOrigin(),
      link: (versionId) =>
        gateway.link({
          artifactId: input.artifactId,
          version: numbers.get(versionId) as number,
        }),
      skipped,
      crashes: () => [...crashes],
      replaceServer: async () => {
        const version = workerVersion(candidate.versionId);
        if (version) await pool.replace(version);
        sources = readLiveSources(candidate.dir);
        live.replaced(candidate.versionId);
      },
      onSubmission: (listener) => interaction.onSubmission(listener),
      liveFailures: () =>
        live.failures(input.artifactId).map(({ key, error }) => ({
          key,
          message: error.message,
          ...(error.code !== undefined ? { code: error.code } : {}),
        })),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
