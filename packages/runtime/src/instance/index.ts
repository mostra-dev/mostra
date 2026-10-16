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
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  BROWSER_PROTOCOL_REVISIONS,
  type ClientInfo,
  type Diagnostic,
  EVENTS_NOTIFY,
  type InstanceInfo,
  type JsonRpcParams,
  type MostraInitializeResult,
  type PortTrustedControlsActivatedParams,
  portTrustedControlsActivatedMethod,
  portTrustedControlsPolicyMethod,
  RpcError,
} from "@mostra/protocol";
import { createAddressing, resolveBind } from "../addressing/index.ts";
import { coverageMatcher, createSpaRenderMode, readFieldCoverage } from "../builder/index.ts";
import { createDependencies, locateWarmSet, recoverDependencies } from "../deps/index.ts";
import { faultsFrom } from "../faults.ts";
import {
  Capabilities,
  CONTROLS_POLICY_TIMEOUT_MS,
  capabilityKey,
  controlsPolicy,
  createGateway,
  type Gateway,
  locateShell,
} from "../gateway/index.ts";
import {
  acquireHome,
  checkPlatform,
  type InstanceRecord,
  type OwnedHome,
  platformName,
  readHomeSettings,
  resolveHomePath,
  writeHomeSettings,
} from "../home/index.ts";
import { createInteraction, type Interaction } from "../interaction/index.ts";
import type { Environment, Log } from "../log.ts";
import { openProcessManager, type ProcessManager, type ReapedChild } from "../processes/index.ts";
import { ProtocolServer, sessionMethods } from "../protocol-server/index.ts";
import {
  artifactMethods,
  canonicalRef,
  createPublisher,
  type Publisher,
  versionDamage,
} from "../publish/index.ts";
import { openRegistry } from "../registry/index.ts";

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
  // Built on first use: a runtime without its warm set still starts and says what's missing.
  let publisher: Publisher | undefined;
  const getPublisher = (): Publisher => {
    if (publisher) return publisher;
    const warm = locateWarmSet(environment);
    publisher = createPublisher({
      registry,
      ledger: home.ledger,
      dependencies: createDependencies({
        home: home.path,
        ledger: home.ledger,
        processes: manager,
        log,
        env: environment,
        warm,
        policy: () => readHomeSettings(home.path).dependencies ?? "auto",
        faults,
        // Tests shorten the 300 s install limit to exercise MOSTRA_DEP_TIMEOUT.
        ...(Number(environment["MOSTRA_TEST_INSTALL_TIMEOUT_MS"]) > 0
          ? { installTimeoutMs: Number(environment["MOSTRA_TEST_INSTALL_TIMEOUT_MS"]) }
          : {}),
      }),
      renderMode: createSpaRenderMode({
        processes: manager,
        log,
        env: environment,
        // Tests shorten the 180 s build limit to exercise MOSTRA_BUILD_TIMEOUT.
        ...(Number(environment["MOSTRA_TEST_BUILD_TIMEOUT_MS"]) > 0
          ? { timeoutMs: Number(environment["MOSTRA_TEST_BUILD_TIMEOUT_MS"]) }
          : {}),
      }),
      runtimeVersion: runtimeVersion(),
      log,
      faults,
      homePolicy: () => readHomeSettings(home.path).submission,
    });
    return publisher;
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
    revisions: servedRevisions(environment["MOSTRA_TEST_BROWSER_REVISION_NEXT"], log),
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
    supportedPorts: ["submissions", "drafts", "trustedControls"],
    notifications: [EVENTS_NOTIFY],
    onInitialized: (session) => interaction.connected(session),
    onClosed: (session) => interaction.disconnected(session),
    redact: (text) => home.redactor.redact(text),
    handlers: [
      ...artifactMethods({
        registry,
        publisher: getPublisher,
        link: (artifactId) => gateway.defaultLink(artifactId),
      }),
      ...gateway.methods(),
      ...interaction.methods(),
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
        interaction.stop();
        server.close();
        await gateway.close();
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
    home.publish(options.mode);
  } catch (error) {
    // Undo what started before the home is released, so no listener or child outlives it.
    interaction.stop();
    server.close();
    await gateway.close();
    await manager.stopAll();
    throw error;
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
