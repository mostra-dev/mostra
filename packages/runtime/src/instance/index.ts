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
  type ClientInfo,
  type Diagnostic,
  type InstanceInfo,
  type MostraInitializeResult,
  RpcError,
} from "@mostra/protocol";
import { createSpaRenderMode, locateWarmSet } from "../builder/index.ts";
import { faultsFrom } from "../faults.ts";
import {
  acquireHome,
  checkPlatform,
  type InstanceRecord,
  type OwnedHome,
  platformName,
  resolveHomePath,
} from "../home/index.ts";
import type { Environment } from "../log.ts";
import { openProcessManager, type ProcessManager, type ReapedChild } from "../processes/index.ts";
import { ProtocolServer, sessionMethods } from "../protocol-server/index.ts";
import { artifactMethods, createPublisher, type Publisher } from "../publish/index.ts";
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
  // Built on first use: a runtime without its warm set still starts and says what's missing.
  let publisher: Publisher | undefined;
  const getPublisher = (): Publisher => {
    if (publisher) return publisher;
    const warm = locateWarmSet(environment);
    publisher = createPublisher({
      registry,
      ledger: home.ledger,
      renderMode: createSpaRenderMode({
        processes: manager,
        log,
        warm,
        env: environment,
        // Tests shorten the 180 s build limit to exercise MOSTRA_BUILD_TIMEOUT.
        ...(Number(environment["MOSTRA_TEST_BUILD_TIMEOUT_MS"]) > 0
          ? { timeoutMs: Number(environment["MOSTRA_TEST_BUILD_TIMEOUT_MS"]) }
          : {}),
      }),
      warm,
      runtimeVersion: runtimeVersion(),
      log,
      faults,
    });
    return publisher;
  };
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
    supportedPorts: [],
    handlers: [
      ...artifactMethods({ registry, publisher: getPublisher }),
      ...sessionMethods({
        describe: () => info,
        startedAt: home.startedAt,
        socketPath: () => home.socketPath,
        connections: () => server.connections,
        processes: () => manager.list(),
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
        server.close();
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
    await server.listen(home.socketPath, options.checkIntervalMs);
    home.publish(options.mode);
  } catch (error) {
    // Undo what started before the home is released, so no listener or child outlives it.
    server.close();
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
  log.info("instance.started", { mode: options.mode, pid: process.pid, socket: home.socketPath });
  return instance;
}
