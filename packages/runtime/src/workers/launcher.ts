/**
 * Launching artifact workers (D124): the `WorkerLauncher` seam that becomes the remote server's
 * `SandboxPort`. A launch names the version by reference (its ID, output digest and a locator),
 * never by a directory path, and the channel it returns carries only serializable messages, so a
 * launcher whose worker runs as a separate process over a socket, or on another machine, fits
 * without a change. Secrets never travel in `env`: a worker asks for them by name (D44).
 */
import { connect } from "node:net";
import { resolve } from "node:path";
import type { Duplex } from "node:stream";
import {
  encodeLine,
  type JsonRpcMessage,
  LineSplitter,
  type WorkerLimits,
  type WorkerVersionRef,
} from "@mostra/protocol";
import type { Environment } from "../log.ts";
import type { ProcessManager } from "../processes/index.ts";

/** How a worker ended. */
export interface WorkerExit {
  readonly code: number | null;
  readonly signal: string | null;
  /** Its last stderr lines, redacted. */
  readonly stderrTail: readonly string[];
}

/** What a launcher starts. */
export interface WorkerLaunchSpec {
  readonly artifactId: string;
  readonly version: WorkerVersionRef;
  /** The worker's environment: never a secret (D124). */
  readonly env: Environment;
  readonly limits: WorkerLimits;
  /**
   * The artifact's source directory on the owner's machine, when it still exists: the working
   * directory of server code and the root of `watch` globs. A launcher elsewhere ignores it.
   */
  readonly sourceDir?: string;
}

/** A started worker's connection: JSON-RPC messages both ways, and how it ends. */
export interface WorkerChannel {
  /** Sends one message to the worker. Does nothing once it has ended. */
  send(message: JsonRpcMessage): void;
  /** Receives every message from the worker; set once, before the first message is read. */
  onMessage(listener: (message: unknown) => void): void;
  /** Resolves once the worker has ended, for whatever reason. */
  readonly ended: Promise<WorkerExit>;
  /** Ends the worker now (SIGKILL locally). */
  kill(): void;
  /** The worker's process, when it runs on this machine. */
  readonly pid?: number;
}

/** Starts workers (D124). */
export interface WorkerLauncher {
  launch(spec: WorkerLaunchSpec): Promise<WorkerChannel>;
}

/** Reads newline-delimited JSON from `stream` into `deliver`. */
function readLines(stream: Duplex, deliver: (message: unknown) => void): void {
  const splitter = new LineSplitter();
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    let lines: string[];
    try {
      lines = splitter.push(chunk);
    } catch {
      stream.destroy();
      return;
    }
    for (const line of lines) {
      if (line.trim() === "") continue;
      try {
        deliver(JSON.parse(line));
      } catch {
        // A worker that writes garbage is answered by nothing; its calls time out or it is killed.
      }
    }
  });
}

/** Options for {@link localLauncher}. */
export interface LocalLauncherOptions {
  readonly processes: ProcessManager;
  /** The home's real path, which `home:` locators resolve inside. */
  readonly home: string;
  /** The worker's process entry (`@mostra/worker`'s `dist/main.js`). */
  readonly workerEntry: string;
  /** Extra Node flags, such as `--conditions` in tests. */
  readonly nodeArgs?: readonly string[];
  /**
   * The `node_modules` the version's packages resolve from (D135), made ready before the worker
   * starts; without it, the server bundle's package imports have nothing to resolve from.
   */
  readonly modules?: (target: {
    readonly artifactId: string;
    readonly versionDir: string;
    readonly sourceDir?: string;
  }) => Promise<string>;
}

/**
 * The local launcher: resolves a `home:` locator to the version's directory in this home and
 * forks the worker as a child of the process manager, in its own process group, with its channel
 * as fd 4 and the heap limit as a V8 flag.
 */
export function localLauncher(options: LocalLauncherOptions): WorkerLauncher {
  return {
    async launch(spec) {
      if (!spec.version.locator.startsWith("home:")) {
        throw new Error(`The local launcher can't reach ${spec.version.locator}.`);
      }
      const versionDir = resolve(options.home, spec.version.locator.slice("home:".length));
      if (!versionDir.startsWith(`${resolve(options.home, "versions")}/`)) {
        throw new Error("A home: locator names a version directory of the home.");
      }
      const modules = await options.modules?.({
        artifactId: spec.artifactId,
        versionDir,
        ...(spec.sourceDir ? { sourceDir: spec.sourceDir } : {}),
      });
      const child = await options.processes.spawn({
        kind: "worker",
        ownerRef: spec.version.versionId,
        command: process.execPath,
        args: [
          `--max-old-space-size=${spec.limits.heapMb}`,
          ...(options.nodeArgs ?? []),
          options.workerEntry,
          "--channel",
          "fd:4",
          "--version-dir",
          versionDir,
          ...(spec.sourceDir ? ["--source-dir", spec.sourceDir] : []),
          ...(modules ? ["--modules", modules] : []),
        ],
        cwd: spec.sourceDir ?? versionDir,
        env: spec.env,
        channel: true,
      });
      const stream = child.channel;
      if (!stream) throw new Error("The worker started without its channel.");
      let ended = false;
      void child.exited.then(() => {
        ended = true;
      });
      return {
        pid: child.pid,
        send(message) {
          if (ended || stream.destroyed) return;
          stream.write(encodeLine(message));
        },
        onMessage(listener) {
          readLines(stream, listener);
        },
        ended: child.exited.then((exit) => ({
          code: exit.code,
          signal: exit.signal,
          stderrTail: exit.stderrTail,
        })),
        kill() {
          void child.stop(0);
        },
      };
    },
  };
}

/** The line a worker host sends after its worker ended, before it closes the connection. */
export interface WorkerHostExitLine {
  readonly mostraWorkerExit: WorkerExit;
}

/**
 * A launcher whose workers run in a separately started worker host, reached over a Unix socket
 * (D124's proof that the seam fits a worker elsewhere). Each launch opens one connection and sends
 * the launch spec as its first line, without the source directory (the host has its own files);
 * the host starts the worker, passes messages through, and ends the connection with a
 * {@link WorkerHostExitLine} once the worker ended. Closing the connection ends the worker.
 */
export function socketLauncher(socketPath: string): WorkerLauncher {
  return {
    launch(spec) {
      return new Promise<WorkerChannel>((resolveLaunch, rejectLaunch) => {
        const socket = connect(socketPath);
        let exit: WorkerExit | undefined;
        let listener: ((message: unknown) => void) | undefined;
        let resolveEnded!: (exit: WorkerExit) => void;
        const ended = new Promise<WorkerExit>((done) => {
          resolveEnded = done;
        });
        socket.once("error", rejectLaunch);
        socket.once("connect", () => {
          socket.off("error", rejectLaunch);
          socket.on("error", () => socket.destroy());
          const { sourceDir: _local, ...remote } = spec;
          socket.write(`${JSON.stringify({ launch: remote })}\n`);
          readLines(socket, (message) => {
            const line = message as Partial<WorkerHostExitLine>;
            if (line.mostraWorkerExit) exit = line.mostraWorkerExit;
            else listener?.(message);
          });
          socket.once("close", () =>
            resolveEnded(
              exit ?? {
                code: null,
                signal: "SIGKILL",
                stderrTail: ["The worker host closed the connection."],
              },
            ),
          );
          resolveLaunch({
            send(message) {
              if (!socket.destroyed) socket.write(encodeLine(message));
            },
            onMessage(next) {
              listener = next;
            },
            ended,
            kill() {
              socket.destroy();
            },
          });
        });
      });
    },
  };
}

/**
 * Where the worker's process entry is: `MOSTRA_WORKER_ENTRY` when set, else `@mostra/worker`
 * beside this runtime (`worker/dist/main.js`; its source, run with the source condition, when
 * this runtime runs from source too).
 */
export function locateWorker(
  env: Environment,
  runtimeRoot: string,
): { readonly entry: string; readonly nodeArgs: readonly string[] } {
  const override = env["MOSTRA_WORKER_ENTRY"];
  if (override) return { entry: override, nodeArgs: [] };
  const fromSource = import.meta.url.endsWith(".ts");
  return fromSource
    ? {
        entry: resolve(runtimeRoot, "..", "worker", "src", "main.ts"),
        nodeArgs: ["--conditions=@mostra/source"],
      }
    : { entry: resolve(runtimeRoot, "..", "worker", "dist", "main.js"), nodeArgs: [] };
}
