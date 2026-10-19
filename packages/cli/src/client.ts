/**
 * The CLI's connection to its home's instance (D45, D81, INTERFACES §9): it attaches to the
 * daemon recorded in `instance.json`, or starts one (`mostra-runtime daemon`, which itself
 * attaches when another starter won), and opens a session as `mostra-cli`. The SDK (WP-11) does
 * the same few steps over the same protocol.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import {
  ARTIFACT_PROGRESS,
  CLI_CLIENT_NAME,
  createDiagnostic,
  DEV_NOTIFY,
  type Diagnostic,
  encodeLine,
  HOST_PROTOCOL_REVISIONS,
  LineSplitter,
  type MethodDefinition,
  type MostraInitializeResult,
  mostraInitializeMethod,
  RpcError,
  RpcPeer,
} from "@mostra/protocol";
import { type Environment, locateRuntime } from "./home.ts";
import { cliVersion } from "./version.ts";

/** The instance a command reached: the `instance` of the `--json` envelope (the attach target). */
export interface InstanceSummary {
  /** The home it owns. */
  readonly home: string;
  /** The control socket the CLI reached. */
  readonly socket: string;
  /** Its process ID. */
  readonly pid: number;
  /** `daemon`, or `host` for an instance a host spawned (telemetry sends nothing then, D140). */
  readonly mode: "host" | "daemon";
  /** The runtime's release. */
  readonly version: string;
  /** Whether this command started the daemon. */
  readonly started: boolean;
}

/** An open session with the home's instance. */
export interface InstanceConnection {
  /** What the instance is. */
  readonly summary: InstanceSummary;
  /** `mostra/initialize`'s warnings. */
  readonly warnings: readonly Diagnostic[];
  /** Calls a host protocol method. */
  call<P, R>(method: MethodDefinition<P, R>, params: P, timeoutMs?: number): Promise<R>;
  /** Registers a handler for a notification (`artifact/progress`, `dev/notify`). */
  onNotification(method: string, handler: (params: unknown) => void): void;
  /** Resolves when the connection closes. */
  readonly closed: Promise<void>;
  /** Ends the session. */
  close(): void;
}

/** How to reach an instance. */
export interface ConnectOptions {
  readonly home: string;
  readonly env: Environment;
  /** Start the daemon when none runs. Default true. */
  readonly autostart?: boolean;
  /**
   * Told when this connection starts the home's daemon (`true`) and when the start ends
   * (`false`), so the command's own `--timeout` names the start if it runs out during it.
   */
  readonly onStarting?: (starting: boolean) => void;
}

/** How long one attempt to reach a recorded socket waits. */
const ATTACH_TIMEOUT_MS = 5000;
/** How long a daemon this command starts may take to say where it listens. */
const START_TIMEOUT_MS = 30_000;

/**
 * Opens a session with the home's instance, starting its daemon when none runs. Returns
 * `undefined` when `autostart` is false and no instance runs. Throws the start's diagnostic when
 * the daemon can't start (`MOSTRA_HOME_LOCKED`, `MOSTRA_PLATFORM_UNSUPPORTED` …).
 */
export async function connect(options: ConnectOptions): Promise<InstanceConnection | undefined> {
  const recorded = readSocket(options.home);
  if (recorded !== undefined) {
    const session = await open(recorded, options, false).catch(() => undefined);
    if (session) return session;
  }
  if (options.autostart === false) return undefined;
  options.onStarting?.(true);
  let started: DaemonLine;
  try {
    started = await startDaemon(options);
  } finally {
    options.onStarting?.(false);
  }
  return open(started.socket, options, started.status === "started");
}

/** The socket `instance.json` records (D81), if the file exists and reads. */
function readSocket(home: string): string | undefined {
  try {
    const record = JSON.parse(readFileSync(join(home, "instance.json"), "utf8")) as {
      socket?: unknown;
    };
    return typeof record.socket === "string" ? record.socket : undefined;
  } catch {
    return undefined;
  }
}

/** What `mostra-runtime daemon` prints on its one line. */
interface DaemonLine {
  readonly status: "started" | "attached" | "failed";
  readonly socket: string;
  readonly pid?: number;
  readonly diagnostic?: Diagnostic;
}

/**
 * Starts the home's daemon, detached from this process, and reads the one line it prints: where
 * it listens, or why it couldn't start. A daemon another starter won prints `attached` and exits.
 */
export async function startDaemon(options: ConnectOptions): Promise<DaemonLine> {
  // The start's own limit. A shorter `--timeout` is the command's: its one timer names the
  // start when it runs out during it (run.ts), so two timers never race for one deadline.
  const deadlineAt = Date.now() + START_TIMEOUT_MS;
  const timedOut = (): RpcError =>
    new RpcError(
      createDiagnostic("MOSTRA_HOST_TIMEOUT", {
        message: `The home's daemon didn't start within ${formatDuration(START_TIMEOUT_MS)}.`,
      }),
    );
  const runtime = await locateRuntime(options.env);
  if (Date.now() >= deadlineAt) throw timedOut();
  const args = [
    runtime.entry,
    "daemon",
    // The home this CLI resolved, so the daemon owns exactly it whatever its own environment.
    "--home",
    options.home,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(runtime.node, args, {
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, ...options.env } as NodeJS.ProcessEnv,
    });
    const splitter = new LineSplitter();
    let settled = false;
    const finish = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.removeAllListeners("data");
      child.stdout?.destroy();
      child.unref();
      outcome();
    };
    const timer = setTimeout(
      () => finish(() => reject(timedOut())),
      Math.max(0, deadlineAt - Date.now()),
    );
    child.on("error", (error) =>
      finish(() =>
        reject(
          new RpcError(
            createDiagnostic("MOSTRA_ENV_RUNTIME_MISSING", {
              message: `The runtime couldn't be started: ${error.message}`,
            }),
          ),
        ),
      ),
    );
    // `close`, not `exit`: a daemon that found another one prints `attached` and exits at once,
    // and its line may still be in the pipe when `exit` fires.
    child.on("close", (code) =>
      finish(() =>
        reject(
          new RpcError(
            createDiagnostic("MOSTRA_HOST_CONNECTION_CLOSED", {
              message: `The home's daemon exited (${code ?? "signal"}) before it said where it listens.`,
            }),
          ),
        ),
      ),
    );
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      for (const line of splitter.push(chunk)) {
        let parsed: DaemonLine;
        try {
          parsed = JSON.parse(line) as DaemonLine;
        } catch {
          continue;
        }
        finish(() => {
          if (parsed.status === "failed") {
            reject(
              new RpcError(
                parsed.diagnostic ??
                  createDiagnostic("MOSTRA_HOST_INTERNAL_ERROR", {
                    message: "The home's daemon failed to start.",
                  }),
              ),
            );
          } else resolve(parsed);
        });
        return;
      }
    });
  });
}

async function open(
  socketPath: string,
  options: ConnectOptions,
  started: boolean,
): Promise<InstanceConnection> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const connection = createConnection(socketPath);
    const timer = setTimeout(() => {
      connection.destroy();
      reject(closed(socketPath, "timed out"));
    }, ATTACH_TIMEOUT_MS);
    connection.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(closed(socketPath, error.code ?? "failed"));
    });
    connection.once("connect", () => {
      clearTimeout(timer);
      resolve(connection);
    });
  });
  const handlers = new Map<string, (params: unknown) => void>();
  const peer = new RpcPeer({
    send: (message) => {
      if (!socket.destroyed) socket.write(encodeLine(message));
    },
    onNotification: (method, params) => handlers.get(method)?.(params),
  });
  let markClosed: () => void = () => {};
  const closedPromise = new Promise<void>((done) => {
    markClosed = done;
  });
  const splitter = new LineSplitter();
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    for (const line of splitter.push(chunk)) peer.receiveLine(line);
  });
  const end = (): void => {
    peer.close();
    markClosed();
  };
  socket.on("close", end);
  socket.on("error", () => socket.destroy());
  let result: MostraInitializeResult;
  try {
    result = await peer.call(
      mostraInitializeMethod,
      {
        client: { name: CLI_CLIENT_NAME, version: cliVersion() },
        revisions: [...HOST_PROTOCOL_REVISIONS],
        capabilities: { notifications: [ARTIFACT_PROGRESS, DEV_NOTIFY] },
        ports: [],
        // A check, never a setting (D84): the instance refuses a session for another home.
        home: { path: options.home },
      },
      { timeoutMs: ATTACH_TIMEOUT_MS },
    );
  } catch (error) {
    socket.destroy();
    throw error;
  }
  return {
    summary: {
      home: result.instance.home,
      socket: socketPath,
      pid: result.instance.pid,
      mode: result.instance.mode,
      version: result.instance.version,
      started,
    },
    warnings: result.warnings,
    call: (method, params, timeoutMs) =>
      peer.call(method, params, timeoutMs !== undefined ? { timeoutMs } : {}),
    onNotification: (method, handler) => {
      handlers.set(method, handler);
    },
    closed: closedPromise,
    close: () => {
      peer.close();
      socket.end();
      socket.destroy();
    },
  };
}

function closed(path: string, why: string): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_HOST_CONNECTION_CLOSED", {
      message: `Couldn't reach the instance at ${path} (${why}).`,
    }),
  );
}

/** A limit as people write it: `250 ms`, `5 s`, `1.5 s`. */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
}
