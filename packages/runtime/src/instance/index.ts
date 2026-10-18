/**
 * The instance (D45, D85, D87): the composition root. It assembles the home, the ledger, the
 * process manager and the protocol server in their start-up order and stops them in reverse. It
 * holds no policy of its own; each rule lives in the module that owns it.
 *
 * ```ts
 * const started = await startInstance({ mode: "daemon", home: "/path/to/home" });
 * if (started.kind === "attached") console.log(`already running as ${started.record.pid}`);
 * else await started.instance.stopped;
 * ```
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  ARTIFACT_PROGRESS,
  BROWSER_PROTOCOL_REVISIONS,
  type ClientInfo,
  type Diagnostic,
  EVENTS_NOTIFY,
  type InstanceInfo,
  type JsonRpcParams,
  type MostraInitializeResult,
  type PortTrustedControlsActivatedParams,
  portSecretsGetMethod,
  portTrustedControlsActivatedMethod,
  portTrustedControlsPolicyMethod,
  RpcError,
} from "@mostra/protocol";
import { createActions } from "../actions/index.ts";
import { createAddressing, resolveBind } from "../addressing/index.ts";
import {
  coverageMatcher,
  createSpaRenderMode,
  type RenderMode,
  readFieldCoverage,
  readLiveSources,
  readServerFunctions,
} from "../builder/index.ts";
import {
  createDependencies,
  type Dependencies,
  locateWarmSet,
  recoverDependencies,
  runtimeRoot,
} from "../deps/index.ts";
import { faultsFrom } from "../faults.ts";
import { Gate } from "../gate.ts";
import {
  Capabilities,
  CONTROLS_POLICY_TIMEOUT_MS,
  capabilityKey,
  controlsPolicy,
  createGateway,
  type Gateway,
  locateShell,
} from "../gateway/index.ts";
import { createGc, gcMethods } from "../gc/index.ts";
import {
  acquireHome,
  checkPlatform,
  type InstanceRecord,
  markHostConfigured,
  type OwnedHome,
  platformName,
  readHomeSettings,
  resolveHomePath,
  writeHomeSettings,
} from "../home/index.ts";
import {
  createEphemeralBus,
  createInteraction,
  type Interaction,
  redactEvents,
} from "../interaction/index.ts";
import { createLive, type LatestLive, liveMethods } from "../live/index.ts";
import type { Environment, Log } from "../log.ts";
import {
  artifactEnvironment,
  openProcessManager,
  type ProcessManager,
  type ReapedChild,
} from "../processes/index.ts";
import { ProtocolServer, sessionMethods } from "../protocol-server/index.ts";
import {
  artifactMethods,
  canonicalRef,
  createPublisher,
  instanceChecks,
  type Publisher,
  versionDamage,
} from "../publish/index.ts";
import { openRegistry } from "../registry/index.ts";
import { openSecrets, secretMethods } from "../secrets/index.ts";
import { hasLoginService, type IdleWatch, watchIdle } from "../service/index.ts";
import {
  createRunnerClient,
  createVerifier,
  locateRunner,
  type RunnerClient,
  recoverVerify,
  type Verifier,
} from "../verify/index.ts";
import {
  createWorkerPool,
  localLauncher,
  locateWorker,
  socketLauncher,
  type WorkerLauncher,
  type WorkerVersion,
  workerLimits,
} from "../workers/index.ts";

/** Options for {@link startInstance}. */
export interface StartInstanceOptions {
  /** `host`: serve `stdio` and live as long as it; `daemon`: serve the socket until stopped. */
  readonly mode: "host" | "daemon";
  /** `--home`. */
  readonly home?: string | undefined;
  /** The environment: `MOSTRA_HOME`, `MOSTRA_RUNTIME_DIR`, XDG variables. Default `process.env`. */
  readonly env?: Environment;
  /** The host's connection, required in `host` mode. */
  readonly stdio?: { readonly input: Readable; readonly output: Writable };
  /** How long a starter waits for a locked home's owner. Default 20 s. */
  readonly waitMs?: number;
  /** How often the socket and the home are checked, in ms (at most 10 s). Default 5 s. */
  readonly checkIntervalMs?: number;
  /** Where warnings and errors are mirrored besides the log, such as stderr. */
  readonly mirror?: (line: string) => void;
  /** `--bind`: the address the gateway listens on; `127.0.0.1` when absent (D99). */
  readonly bind?: string | undefined;
  /** `--url-host`: the host name URLs use; required with a wildcard `--bind` (D99). */
  readonly urlHost?: string | undefined;
  /**
   * `--always-on`: a daemon that never exits for lack of work, as the login service runs it
   * (D62). Without it a daemon exits after 30 idle minutes.
   */
  readonly alwaysOn?: boolean;
}

/** How a stopped instance ended. */
export interface InstanceStop {
  /** Why it stopped. */
  readonly reason: string;
  /** 0 for a requested stop; 3 when the home disappeared; 1 for an unexpected failure. */
  readonly exitCode: number;
  /** The diagnostic, when it stopped because of one. */
  readonly diagnostic?: Diagnostic;
}

/** A running instance that owns its home. */
export interface Instance {
  /** What `mostra/initialize` reports. */
  readonly info: InstanceInfo;
  /** The control socket clients attach to. */
  readonly socketPath: string;
  /** The process manager every child goes through. */
  readonly processes: ProcessManager;
  /** What start-up reaped from an earlier supervisor of this home. */
  readonly reaped: readonly ReapedChild[];
  /** Resolves when the instance has stopped and released its home. */
  readonly stopped: Promise<InstanceStop>;
  /** Stops the instance (D87). Idempotent; resolves with the first stop's outcome. */
  stop(reason: string, exitCode?: number, diagnostic?: Diagnostic): Promise<InstanceStop>;
}

/** The outcome of {@link startInstance}. */
export type StartedInstance =
  | { readonly kind: "owner"; readonly instance: Instance }
  | {
      readonly kind: "attached";
      /** The instance that owns the home. */
      readonly record: InstanceRecord;
      readonly result: MostraInitializeResult;
    };

let version: string | undefined;
/** This runtime's release, from its package.json. */
export function runtimeVersion(): string {
  if (version !== undefined) return version;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
        version?: string;
      };
      if (manifest.name === "@mostra/runtime" && manifest.version) {
        version = manifest.version;
        return version;
      }
    } catch {
      // Keep looking upwards.
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("Couldn't find @mostra/runtime's package.json.");
    dir = parent;
  }
}

const CLIENT: ClientInfo = { name: "mostra-runtime", version: "" };

/**
 * Starts an instance for a home (RT-06): the platform gate, then the home's lock, migrations,
 * reaping, the socket and `instance.json`. A daemon starter that finds the home owned attaches
 * to the owner instead. Throws an `RpcError` carrying the diagnostic when it can do neither.
 */
export async function startInstance(options: StartInstanceOptions): Promise<StartedInstance> {
  const gate = checkPlatform();
  if (gate) throw new RpcError(gate);
  if (options.mode === "host" && !options.stdio) throw new Error("host mode needs stdio.");
  // Wrong bind flags fail before the home is touched (D99).
  resolveBind({ bind: options.bind, urlHost: options.urlHost });
  const env = options.env ?? process.env;
  const acquisition = await acquireHome({
    home: resolveHomePath({ home: options.home, env }),
    env,
    mode: options.mode,
    runtimeVersion: runtimeVersion(),
    client: { ...CLIENT, version: runtimeVersion() },
    ...(options.waitMs !== undefined ? { waitMs: options.waitMs } : {}),
    ...(options.mirror ? { mirror: options.mirror } : {}),
  });
  if (acquisition.kind === "attached") {
    acquisition.connection.close();
    return { kind: "attached", record: acquisition.record, result: acquisition.result };
  }
  try {
    return { kind: "owner", instance: await assemble(acquisition.home, options) };
  } catch (error) {
    acquisition.home.release();
    throw error;
  }
}

function sameHome(home: string, path: string): boolean {
  try {
    return realpathSync(path) === home;
  } catch {
    return resolve(path) === home;
  }
}

async function assemble(home: OwnedHome, options: StartInstanceOptions): Promise<Instance> {
  const { log } = home;
  const environment = options.env ?? process.env;
  const faults = faultsFrom(environment);
  const { manager, reaped } = await openProcessManager({
    ledger: home.ledger,
    log,
    redactor: home.redactor,
    faults,
  });
  const registry = await openRegistry({ home: home.path, ledger: home.ledger });
  const recovered = await registry.recover();
  if (recovered.versions.length > 0 || recovered.snapshots.length > 0) {
    log.info("publish.recovered", { ...recovered });
  }
  await recoverDependencies({ home: home.path, log });
  // What a stopped instance left of verify: sandboxes, unfinished builds, orphan files (D138 item 1).
  await recoverVerify(home.path, log);
  // Building and serving go through the render mode (D19 seam 5): SPA, v1's only one. Made on
  // first use, like the publisher, so a runtime missing its build packages still starts.
  let spa: RenderMode | undefined;
  const renderMode = (): RenderMode => {
    spa ??= createSpaRenderMode({
      processes: manager,
      log,
      env: environment,
      // Tests shorten the 180 s build limit to exercise MOSTRA_BUILD_TIMEOUT.
      ...(Number(environment["MOSTRA_TEST_BUILD_TIMEOUT_MS"]) > 0
        ? { timeoutMs: Number(environment["MOSTRA_TEST_BUILD_TIMEOUT_MS"]) }
        : {}),
    });
    return spa;
  };
  // Built on first use: a runtime without its warm set still starts and says what's missing.
  let dependencies: Dependencies | undefined;
  // gc runs alone; publishes, verify runs and installs share the gate (D140 item 14).
  const gate = new Gate();
  const getDependencies = (): Dependencies =>
    (dependencies ??= createDependencies({
      gate,
      home: home.path,
      ledger: home.ledger,
      processes: manager,
      log,
      env: environment,
      warm: locateWarmSet(environment),
      policy: () => readHomeSettings(home.path).dependencies ?? "auto",
      faults,
      // Tests shorten the 300 s install limit to exercise MOSTRA_DEP_TIMEOUT.
      ...(Number(environment["MOSTRA_TEST_INSTALL_TIMEOUT_MS"]) > 0
        ? { installTimeoutMs: Number(environment["MOSTRA_TEST_INSTALL_TIMEOUT_MS"]) }
        : {}),
    }));
  // Suites of other features publish without verify's gate; the switch is loud (D138).
  const unverifiedPublish = Boolean(environment["MOSTRA_TEST_UNVERIFIED_PUBLISH"]);
  if (unverifiedPublish) log.warn("instance.test_unverified_publish", {});
  let publisher: Publisher | undefined;
  const getPublisher = (): Publisher => {
    if (publisher) return publisher;
    publisher = createPublisher({
      gate,
      registry,
      ledger: home.ledger,
      dependencies: getDependencies(),
      renderMode: renderMode(),
      runtimeVersion: runtimeVersion(),
      log,
      faults,
      homePolicy: () => readHomeSettings(home.path).submission,
      verifier: getVerifier,
      unverified: unverifiedPublish,
    });
    return publisher;
  };
  // verify (WP-09, D138): the runner child with its warm browser, and the sandbox each run serves
  // its build from. Made on first use, like the publisher.
  const revisions = servedRevisions(environment["MOSTRA_TEST_BROWSER_REVISION_NEXT"], log);
  let runner: RunnerClient | undefined;
  let verifier: Verifier | undefined;
  const getVerifier = (): Verifier => {
    if (verifier) return verifier;
    const located = locateRunner(environment, runtimeRoot());
    runner = createRunnerClient({
      processes: manager,
      log,
      env: environment,
      entry: located.entry,
      nodeArgs: located.nodeArgs,
    });
    const workerLocation = locateWorker(environment, runtimeRoot());
    verifier = createVerifier({
      home: home.path,
      ledger: home.ledger,
      registry,
      log,
      redactor: home.redactor,
      runner,
      sandbox: {
        home: home.path,
        log,
        redactor: home.redactor,
        processes: manager,
        runtimeVersion: runtimeVersion(),
        worker: { entry: workerLocation.entry, nodeArgs: workerLocation.nodeArgs },
        modules: (target) => getDependencies().runtimeModules(target),
        secrets,
        env: artifactEnvironment(environment),
        shellDir: locateShell(environment),
        revisions,
        serverEntry: (dir) => renderMode().serverEntry(dir),
        damage: (dir) => versionDamage(dir),
      },
      // Tests shorten verify's 120 s and its smoke test's 200 interactions.
      limits: {
        ...(Number(environment["MOSTRA_TEST_VERIFY_TIMEOUT_MS"]) > 0
          ? { timeoutMs: Number(environment["MOSTRA_TEST_VERIFY_TIMEOUT_MS"]) }
          : {}),
        ...(Number(environment["MOSTRA_TEST_SMOKE_INTERACTIONS"]) > 0
          ? { smokeInteractions: Number(environment["MOSTRA_TEST_SMOKE_INTERACTIONS"]) }
          : {}),
      },
      // verify clears the artifact's park, for its calls and its live producers (D133).
      clearPark: (artifactId) => {
        pool.clear(artifactId);
        live.unpark(artifactId);
      },
    });
    return verifier;
  };
  // The gateway (WP-05): leased ports, capability links and sessions, static versions.
  const clockOffset = testClockOffset(environment["MOSTRA_TEST_CLOCK_OFFSET_MS"], log);
  const addressing = createAddressing({
    ledger: home.ledger,
    log,
    bind: resolveBind({ bind: options.bind, urlHost: options.urlHost }),
  });
  const capabilities = new Capabilities({
    ledger: home.ledger,
    log,
    key: capabilityKey(home.path, log),
    // Tests move the gateway's clock to check link lifetimes (LL-05, HY-03).
    now: () => Date.now() + clockOffset,
    shellOrigin: () => gateway.shellOrigin(),
  });
  // The interaction core (WP-06): drafts, state, submissions, the outbox, events and waits. Its
  // host connections are the protocol server's, built below.
  const interaction: Interaction = createInteraction({
    ledger: home.ledger,
    log,
    faults,
    hosts: {
      registrants: (port) => server.registrants(port),
      call: (session, method, params, timeoutMs) =>
        server.callSession(session, method, params as JsonRpcParams, timeoutMs),
      notify: (session, method, params) => server.notify(session, method, params as JsonRpcParams),
      drained: (session) => server.drained(session),
    },
    // The hosts that always provide the submissions port (D105).
    expectedHosts: () =>
      Object.entries(readHomeSettings(home.path).expectedPorts ?? {})
        .filter(([, ports]) => ports.includes("submissions"))
        .map(([owner]) => owner),
    artifacts: { resolve: (ref) => registry.get(canonicalRef(ref)).id },
    // Which field IDs each version covers (D109); versions are immutable, so it is read once.
    coverage: (() => {
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
    })(),
    // Tests shorten the 30 s port-call limit to exercise a host that never answers.
    ...(Number(environment["MOSTRA_TEST_PORT_TIMEOUT_MS"]) > 0
      ? { portTimeoutMs: Number(environment["MOSTRA_TEST_PORT_TIMEOUT_MS"]) }
      : {}),
  });
  // Server code (WP-08): secrets, the worker pool, action runs and live sources. Every secret the
  // home holds is protected from the log and the event log before anything runs.
  const stopRedactingEvents = redactEvents(home.redactor);
  const secrets = openSecrets({
    home: home.path,
    redactor: home.redactor,
    log,
    port: () => {
      const registrant = server.registrants("secrets").at(-1);
      if (!registrant) return undefined;
      return async (request) => {
        const value = await server.callSession(
          registrant.session,
          portSecretsGetMethod.method,
          request as unknown as JsonRpcParams,
          PORT_TIMEOUT_MS,
        );
        return typeof value === "string" ? value : null;
      };
    },
  });
  // Tests shorten the one-minute lease a page's interest in a run or live source holds.
  const testLease = Number(environment["MOSTRA_TEST_INTEREST_LEASE_MS"]);
  const bus = createEphemeralBus(testLease > 0 ? { leaseMs: testLease } : {});
  // The local launcher forks workers from this home's versions; tests prove the seam with a worker
  // host started on its own, reached over a socket (D124).
  const workerSocket = environment["MOSTRA_TEST_WORKER_HOST"];
  const located = locateWorker(environment, runtimeRoot());
  const launcher: WorkerLauncher = workerSocket
    ? socketLauncher(workerSocket)
    : localLauncher({
        processes: manager,
        home: home.path,
        workerEntry: located.entry,
        nodeArgs: located.nodeArgs,
        // A version's packages run from the layout it was built against (D135).
        modules: (target) => getDependencies().runtimeModules(target),
      });
  if (workerSocket) log.warn("workers.test_host", { socket: workerSocket });
  const workerVersions = new Map<string, WorkerVersion | null>();
  /** What a version's worker needs, or `null` for a version without server code (RT-05). */
  const workerVersion = (versionId: string): WorkerVersion | undefined => {
    const cached = workerVersions.get(versionId);
    if (cached !== undefined) return cached ?? undefined;
    const version = registry.version(versionId);
    const dir = registry.store.versionDir(versionId);
    // The render mode says what a worker loads from a version (D19 seam 5).
    const served = version ? renderMode().serverEntry(dir) : undefined;
    const entry = served === undefined ? undefined : relative(dir, served);
    if (!version || entry === undefined) {
      if (version) workerVersions.set(versionId, null);
      return undefined;
    }
    const source = registry.sourceOf(version.artifactId);
    const sourceDir = source ? sourceDirectory(source) : undefined;
    const resolved: WorkerVersion = {
      artifactId: version.artifactId,
      ref: { versionId, outputDigest: version.outputDigest, locator: `home:versions/${versionId}` },
      entry,
      limits: workerLimits(version.manifest),
      functions: readServerFunctions(dir),
      ...(sourceDir ? { sourceDir } : {}),
    };
    workerVersions.set(versionId, resolved);
    return resolved;
  };
  const testIdleMs = Number(environment["MOSTRA_TEST_WORKER_IDLE_MS"]);
  const pool = createWorkerPool({
    launcher,
    log,
    // The artifact's allowlisted environment (D95), never the supervisor's secrets (D124).
    env: artifactEnvironment(environment),
    bridge: {
      request: (worker, method, params, call) =>
        actions.bridge.request(worker, method, params, call),
      log: (worker, line) => actions.bridge.log(worker, line),
      liveValue: (worker, params) => live.produced(worker, params),
    },
    onCrash: (crash) => {
      actions.crashed(crash);
      live.crashed(crash);
      try {
        interaction.workerCrashed(crash);
      } catch (error) {
        log.error("workers.crash_record_failed", { error });
      }
    },
    ...(testIdleMs > 0 ? { idleMsOverride: testIdleMs } : {}),
    // Tests shorten the 1 s first backoff to crash a worker into its park quickly.
    ...(Number(environment["MOSTRA_TEST_WORKER_BACKOFF_MS"]) > 0
      ? { backoffMinMs: Number(environment["MOSTRA_TEST_WORKER_BACKOFF_MS"]) }
      : {}),
  });
  const actions = createActions({
    interaction,
    pool,
    bus,
    secrets,
    redactor: home.redactor,
    log,
    version: workerVersion,
  });
  // Versions are immutable, so each one's live sources are read from its registry once. Which
  // version is each artifact's latest is read from the ledger once, then kept up to date from
  // `version.published`, so a reconcile costs nothing per artifact without live sources, however
  // many the home holds (D132; Opus review 2).
  const liveSourcesOf = new Map<string, ReturnType<typeof readLiveSources>>();
  const sourcesOf = (versionId: string): ReturnType<typeof readLiveSources> => {
    let sources = liveSourcesOf.get(versionId);
    if (!sources) {
      sources = readLiveSources(registry.store.versionDir(versionId));
      liveSourcesOf.set(versionId, sources);
    }
    return sources;
  };
  /** The latest version of each artifact whose latest version defines live sources. */
  const latestWithLive = new Map<string, string>();
  const noteLatest = (artifactId: string, versionId: string): void => {
    if (sourcesOf(versionId).length > 0) latestWithLive.set(artifactId, versionId);
    else latestWithLive.delete(artifactId);
  };
  for (const [artifactId, versionId] of registry.latestVersions())
    noteLatest(artifactId, versionId);
  const latestLive = (artifactId: string): LatestLive | undefined => {
    const versionId = latestWithLive.get(artifactId);
    return versionId ? { versionId, sources: sourcesOf(versionId) } : undefined;
  };
  const live = createLive({
    ledger: home.ledger,
    log,
    bus,
    pool,
    interaction,
    latest: latestLive,
    redactor: home.redactor,
    artifactsWithLive: () => [...latestWithLive.keys()],
    version: workerVersion,
    ...(testLease > 0 ? { reconcileMs: Math.max(100, testLease / 4) } : {}),
  });
  // A new latest version moves its artifact's producers to it (ARCHITECTURE §7).
  const stopWatchingPublishes = interaction.onPublished((artifactId, versionId) => {
    noteLatest(artifactId, versionId);
    live.reconcile();
  });
  // Runs a stopped instance left open end now (D24: never retried).
  actions.recover();

  const shellDir = locateShell(environment);
  if (shellDir === undefined)
    log.warn("gateway.shell_missing", { code: "MOSTRA_ENV_SHELL_MISSING" });
  const gateway: Gateway = createGateway({
    ledger: home.ledger,
    log,
    addressing,
    capabilities,
    artifacts: {
      get: (ref) => registry.get(canonicalRef(ref)),
      versionDir: (versionId) => registry.store.versionDir(versionId),
      damage: (versionId) => versionDamage(registry.store.versionDir(versionId)),
    },
    shellDir,
    interaction,
    actions,
    live,
    bus,
    parked: (versionId) =>
      pool.status().some((w) => w.versionId === versionId && w.state === "parked"),
    revisions,
    controls: (artifact) =>
      controlsPolicy({
        artifact,
        log,
        home: () => readHomeSettings(home.path).submitChannels,
        expected: () =>
          Object.entries(readHomeSettings(home.path).expectedPorts ?? {})
            .filter(([, ports]) => ports.includes("trustedControls"))
            .map(([owner]) => owner),
        registrant: () => server.registrants("trustedControls").at(-1),
        call: (session, params) =>
          server.callSession(
            session,
            portTrustedControlsPolicyMethod.method,
            params as unknown as JsonRpcParams,
            CONTROLS_POLICY_TIMEOUT_MS,
          ),
      }),
    activated: (event) => {
      // Best effort and never retried, like draft mirrors (D105, D108): the change is durable.
      for (const registrant of server.registrants("trustedControls")) {
        const params: PortTrustedControlsActivatedParams = {
          artifactId: event.artifactId,
          control: event.control,
          viewer: interaction.viewer(event.viewerId),
          viewId: event.viewId,
          detail: event.detail,
        };
        server
          .callSession(
            registrant.session,
            portTrustedControlsActivatedMethod.method,
            params as unknown as JsonRpcParams,
            CONTROLS_POLICY_TIMEOUT_MS,
          )
          .catch((error: unknown) =>
            log.warn("gateway.activated_failed", {
              owner: registrant.owner,
              error: (error as Error).message,
            }),
          );
      }
    },
  });
  let gatewayStarted = false;
  let idle: IdleWatch | undefined;
  const info: InstanceInfo = {
    version: runtimeVersion(),
    home: home.path,
    platform: platformName(),
    pid: process.pid,
    mode: options.mode,
  };

  let stopping: Promise<InstanceStop> | undefined;
  let markStopped: (stop: InstanceStop) => void = () => {};
  const stopped = new Promise<InstanceStop>((done) => {
    markStopped = done;
  });

  const server: ProtocolServer = new ProtocolServer({
    log,
    describe: () => info,
    servesHome: (path) => sameHome(home.path, path),
    // A host's settings persist in the home's config.json for every later client (D95, D102,
    // D105).
    configureHome: (config, client) => {
      const current = readHomeSettings(home.path);
      const expectedPorts = { ...(current.expectedPorts ?? {}) };
      if (config.ports !== undefined) {
        if (config.ports.length === 0) delete expectedPorts[client.name];
        else expectedPorts[client.name] = [...new Set(config.ports)].sort();
      }
      const change = {
        ...(config.dependencies !== undefined ? { dependencies: config.dependencies } : {}),
        ...(config.submission !== undefined ? { submission: config.submission } : {}),
        ...(config.ports !== undefined ? { expectedPorts } : {}),
        ...(config.submitChannels !== undefined
          ? { submitChannels: [...new Set(config.submitChannels)].sort() }
          : {}),
      };
      if (Object.keys(change).length === 0) return;
      writeHomeSettings(home.path, change);
      log.info("home.settings_written", {
        client: client.name,
        ...(config.dependencies !== undefined ? { dependencies: config.dependencies } : {}),
        ...(config.submission !== undefined ? { submission: config.submission } : {}),
        ...(config.ports !== undefined ? { ports: config.ports } : {}),
        ...(config.submitChannels !== undefined ? { submitChannels: config.submitChannels } : {}),
      });
    },
    // A host's home never sends the standalone CLI's telemetry (D140 item 4).
    markHostConfigured: (client) => {
      if (markHostConfigured(home.path, client.name))
        log.info("home.host_configured", { client: client.name });
    },
    supportedPorts: ["submissions", "drafts", "trustedControls", "secrets"],
    notifications: [EVENTS_NOTIFY, ARTIFACT_PROGRESS],
    onInitialized: (session) => interaction.connected(session),
    onClosed: (session) => interaction.disconnected(session),
    redact: (text) => home.redactor.redact(text),
    handlers: [
      ...artifactMethods({
        registry,
        publisher: getPublisher,
        link: (artifactId) => gateway.defaultLink(artifactId),
        // Any publish clears the artifact's park, a reused version too (FAILURE_MODEL §2): its
        // calls and its live producers both start again.
        published: (artifactId) => {
          pool.clear(artifactId);
          live.unpark(artifactId);
        },
        notify: (session, method, params) => {
          server.notify(session, method, params as JsonRpcParams);
        },
      }),
      ...gateway.methods(),
      ...interaction.methods(),
      ...secretMethods(secrets, (ref) => registry.get(canonicalRef(ref)).id),
      ...gcMethods(
        createGc({
          ledger: home.ledger,
          registry,
          log,
          gate,
          dependencies: getDependencies,
          // Verify's caches exist only once verify ran; nothing to collect before.
          caches: (dryRun) =>
            verifier ? verifier.collect(dryRun) : Promise.resolve({ count: 0, bytes: 0 }),
          now: () => Date.now() + clockOffset,
        }),
      ),
      ...liveMethods(live, (ref) => registry.get(canonicalRef(ref)).id),
      ...sessionMethods({
        describe: () => info,
        startedAt: home.startedAt,
        socketPath: () => home.socketPath,
        connections: () => server.connections,
        processes: () => manager.list(),
        gateway: () =>
          gatewayStarted
            ? {
                bind: addressing.bindAddress,
                shell: gateway.shellOrigin(),
                artifacts: [...gateway.artifactOrigins()].map(([artifactId, origin]) => ({
                  artifactId,
                  origin,
                })),
              }
            : undefined,
        deliveries: () => interaction.deliveries(),
        workers: () => pool.status(),
        idleExitAt: () => idle?.exitAt(),
        checks: (deep) =>
          instanceChecks({
            deep,
            ledger: home.ledger,
            registry,
            shellDir,
            warm: () => locateWarmSet(environment),
          }),
        shutdown: (reason) => void instance.stop(reason, 0),
      }),
    ],
  });

  const instance: Instance = {
    info,
    socketPath: home.socketPath,
    processes: manager,
    reaped,
    stopped,
    stop(reason, exitCode = 0, diagnostic) {
      stopping ??= (async () => {
        log.info("instance.stopping", { reason, exitCode });
        idle?.stop();
        stopWatchingPublishes();
        live.stop();
        interaction.stop();
        server.close();
        await gateway.close();
        await pool.stopAll();
        await runner?.close();
        bus.close();
        stopRedactingEvents();
        try {
          await manager.stopAll();
        } catch (error) {
          log.error("instance.children_stop_failed", { error });
        }
        home.release();
        const outcome: InstanceStop = diagnostic
          ? { reason, exitCode, diagnostic }
          : { reason, exitCode };
        log.info("instance.stopped", { reason, exitCode });
        markStopped(outcome);
        return outcome;
      })();
      return stopping;
    },
  };

  try {
    await gateway.start();
    gatewayStarted = true;
    await server.listen(home.socketPath, options.checkIntervalMs);
    // Deliveries pending from before a restart go out again (FAILURE_MODEL §4).
    interaction.start();
    // Producers that `always` run, and those hosts subscribe to, start now (LL-04).
    live.start();
    home.publish(options.mode);
    // A host-spawned instance marks its home as a host's (D140 item 4).
    if (options.mode === "host" && markHostConfigured(home.path, "mostra-runtime host"))
      log.info("home.host_configured", { client: "mostra-runtime host" });
  } catch (error) {
    // Undo what started before the home is released, so no listener or child outlives it.
    live.stop();
    interaction.stop();
    server.close();
    await gateway.close();
    await pool.stopAll();
    await manager.stopAll();
    bus.close();
    stopRedactingEvents();
    throw error;
  }
  // A daemon exits after 30 idle minutes unless it was started always-on (D62, RT-08); a
  // host-spawned instance lives as long as its stdio.
  if (options.mode === "daemon" && !options.alwaysOn) {
    const testIdle = Number(environment["MOSTRA_TEST_IDLE_EXIT_MS"]);
    idle = watchIdle({
      ...(testIdle > 0 ? { idleMs: testIdle } : {}),
      busy: () => ({
        clients: server.connections,
        views: bus.activeViews(),
        deliveries: interaction.deliveries().reduce((sum, owner) => sum + owner.pending, 0),
        runs: actions.activity(),
        producers: live.activity(),
        subscriptions: interaction.subscriptionCount(),
        // A home with a login service is always-on, whoever started its daemon (D133).
        loginService: hasLoginService(home.path, environment) ? 1 : 0,
      }),
      onIdle: () => {
        log.info("instance.idle_exit", {});
        void instance.stop("idle", 0);
      },
    });
  }
  home.watch((diagnostic) => {
    log.error("instance.home_gone", { message: diagnostic.message });
    server.refuse(diagnostic);
    void instance.stop("home gone", 3, diagnostic);
  }, options.checkIntervalMs);
  if (options.mode === "host" && options.stdio) {
    server.serve("stdio", options.stdio.input, options.stdio.output, () => {
      void instance.stop("the host closed stdio", 0);
    });
  }
  log.info("instance.started", {
    mode: options.mode,
    pid: process.pid,
    socket: home.socketPath,
    shell: gateway.shellOrigin(),
  });
  return instance;
}

/** The longest test clock offset accepted: ten years. */
const MAX_CLOCK_OFFSET_MS = 10 * 365 * 24 * 60 * 60 * 1000;

/**
 * `MOSTRA_TEST_CLOCK_OFFSET_MS`, the forward move of the gateway's clock that tests use to check
 * link lifetimes. Only a whole number of milliseconds from 0 to ten years counts: a negative one
 * would keep expiring links alive and a huge one would break every date. An offset in use is
 * logged, so a forgotten one is visible.
 */
function testClockOffset(value: string | undefined, log: Log): number {
  if (value === undefined || value === "") return 0;
  const offset = Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_CLOCK_OFFSET_MS) {
    log.warn("instance.test_clock_ignored", { value });
    return 0;
  }
  if (offset > 0) log.warn("instance.test_clock", { offsetMs: offset });
  return offset;
}

/**
 * The browser-protocol revisions the gateway serves: every one Mostra shipped, plus, in tests, a
 * newer test-only revision (`MOSTRA_TEST_BROWSER_REVISION_NEXT`), so a version frozen at today's
 * revision is proven against a gateway at the next one (VR-10, D111). A value that isn't a dated
 * revision newer than the newest is ignored and logged.
 */
function servedRevisions(next: string | undefined, log: Log): readonly string[] {
  const shipped: readonly string[] = BROWSER_PROTOCOL_REVISIONS;
  if (next === undefined || next === "") return shipped;
  const newest = shipped.at(-1) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || next <= newest) {
    log.warn("instance.test_revision_ignored", { next });
    return shipped;
  }
  log.warn("instance.test_revision", { next });
  return [...shipped, next];
}

/** How long a host's `secrets` port has to answer (FAILURE_MODEL §9). */
const PORT_TIMEOUT_MS = 30_000;

/** The directory of an artifact's source: the directory itself, or a single file's directory. */
function sourceDirectory(path: string): string | undefined {
  try {
    return statSync(path).isDirectory() ? path : dirname(path);
  } catch {
    return undefined;
  }
}
