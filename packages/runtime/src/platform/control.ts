/**
 * The home's control endpoint (D81, D82; RT-06, RT-10): how attached clients reach the
 * supervisor. On POSIX it is a Unix socket in the owner-only runtime directory; on Windows a named
 * pipe that only the user can open and that refuses remote clients, which the helper creates and
 * forwards to the supervisor over its descriptor 4 (`crates/mostra-win/src/win/pipe.rs`), because
 * Node.js's own pipes let any local user open them for reading (VERIFIED_FACTS, WP-W1).
 *
 * Either way the caller gets one stream per client and a listener it can check and replace: a
 * socket file that disappeared, or a pipe whose helper stopped, is bound again (D81 item 4).
 */

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, type Stats, statSync, unlinkSync } from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { Duplex } from "node:stream";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import { type OperatingSystem, OS, pathsOf, socketPathLimit, WINDOWS } from "./directories.ts";
import { helperPath } from "./helper.ts";
import { launch } from "./launch.ts";

/** Called once per client with the client's stream. */
export type OnConnection = (stream: Duplex) => void;

/** A started helper pipe: its frame channel and its end. */
export interface PipeProcess {
  readonly channel: Duplex;
  readonly exited: Promise<unknown>;
  stop(): Promise<unknown>;
}

/** Starts `mostra-win pipe <name>` (through the process manager, so it is gated and recorded). */
export type LaunchPipe = (name: string) => Promise<PipeProcess>;

/** A bound control endpoint. */
export interface ControlListener {
  /** What clients connect to, as `instance.json` records it. */
  readonly path: string;
  /** Whether it still serves; false when its socket file is gone or its pipe's helper stopped. */
  intact(): boolean;
  /**
   * Stops serving and removes what it created. Client streams the caller ended first are handed
   * over before the endpoint goes; any still open are ended here, after what they were sent.
   */
  close(): Promise<void>;
}

/**
 * The endpoint for a home. POSIX: `<runtime dir>/<home hash>.sock`, refused with
 * `MOSTRA_HOME_SOCKET_TOO_LONG` past the system's limit. Windows: `\\.\pipe\mostra-<home hash>`,
 * to which each bind adds a random part, so no other program can create the name before the
 * supervisor does; clients learn the full name from `instance.json`.
 */
export function controlEndpoint(
  runtimeDir: string | undefined,
  hash: string,
  os: OperatingSystem = OS,
): string {
  if (os === "win32" || runtimeDir === undefined) return `\\\\.\\pipe\\mostra-${hash}`;
  const path = pathsOf(os).join(runtimeDir, `${hash}.sock`);
  const limit = socketPathLimit(os);
  const length = Buffer.byteLength(path);
  if (length > limit) {
    throw new RpcError(
      createDiagnostic("MOSTRA_HOME_SOCKET_TOO_LONG", {
        message: `The control socket path ${path} is ${length} bytes; this system allows ${limit}.`,
        fix: { kind: "command", command: "export MOSTRA_RUNTIME_DIR=/tmp/mostra-$USER" },
      }),
    );
  }
  return path;
}

/** What a listener reports besides its clients. */
export interface ListenOptions {
  /** Starts the pipe's helper (Windows); default: behind a gate, unrecorded. */
  readonly launchPipe?: LaunchPipe;
  /** Receives the listener's errors after it is bound (a socket's `error` events). */
  readonly onError?: (error: unknown) => void;
}

/** Binds `endpoint` and calls `onConnection` for every client. */
export function listenControl(
  endpoint: string,
  onConnection: OnConnection,
  options: ListenOptions = {},
): Promise<ControlListener> {
  if (WINDOWS) return listenPipe(endpoint, onConnection, options.launchPipe ?? launchPipeDirectly);
  return listenSocket(endpoint, onConnection, options.onError ?? (() => {}));
}

const PIPE_PREFIX = "\\\\.\\pipe\\";

/**
 * Starts the pipe's helper behind its gate without a process manager to record it: for a
 * protocol server outside an instance (the instance always records its helper).
 */
const launchPipeDirectly: LaunchPipe = async (name) => {
  const launched = launch(
    {
      kind: "control-pipe",
      command: helperPath(),
      args: ["pipe", name],
      env: process.env,
      extra: "channel",
    },
    () => {},
  );
  const exited = new Promise((resolve) => launched.process.once("exit", resolve));
  await launched.identify();
  launched.release();
  const channel = launched.process.stdio[4] as Duplex | null;
  if (!channel) throw new Error("The control pipe's helper has no channel.");
  return { channel, exited, stop: () => launched.end(2000, []) };
};

async function listenSocket(
  path: string,
  onConnection: OnConnection,
  onError: (error: unknown) => void,
): Promise<ControlListener> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const server: Server = createServer((socket: Socket) => onConnection(socket));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.off("error", reject);
      resolve();
    });
  });
  chmodSync(path, 0o600);
  server.on("error", onError);
  const stats: Stats = statSync(path);
  const same = (): boolean => {
    try {
      const current = statSync(path);
      return current.ino === stats.ino && current.dev === stats.dev;
    } catch {
      return false;
    }
  };
  return {
    path,
    intact: same,
    async close() {
      // Node removes a Unix socket's file when its server closes, even a newer server's file at
      // the same path, so it closes first and removes only its own file.
      const ours = same();
      server.close();
      if (ours) {
        try {
          unlinkSync(path);
        } catch {
          // Already gone.
        }
      }
    },
  };
}

// The helper's frames: [connection u32 LE][kind u8][length u32 LE][payload].
const OPEN = 1;
const DATA = 2;
const CLOSE = 3;
const READY = 4;
const FATAL = 5;
/** The largest payload the supervisor sends in one frame. */
const MAX_FRAME = 1 << 20;
/** How long the helper may take to create the pipe. */
const READY_MS = 10_000;
/** How long a closing listener waits for its helper to hand clients their bytes (its own 5 s). */
const DRAIN_MS = 6000;

function frame(connection: number, kind: number, payload?: Uint8Array): Buffer {
  const header = Buffer.alloc(9);
  header.writeUInt32LE(connection, 0);
  header[4] = kind;
  header.writeUInt32LE(payload?.length ?? 0, 5);
  return payload ? Buffer.concat([header, payload]) : header;
}

async function listenPipe(
  base: string,
  onConnection: OnConnection,
  launchPipe: LaunchPipe,
): Promise<ControlListener> {
  // An endpoint that isn't a pipe name (a socket path a caller chose) names one by its hash.
  const stem = base.startsWith(PIPE_PREFIX)
    ? base.slice(PIPE_PREFIX.length)
    : `mostra-${createHash("sha256").update(base).digest("hex").slice(0, 16)}`;
  const name = `${stem}-${randomBytes(8).toString("hex")}`;
  const helper = await launchPipe(name);
  const streams = new Map<number, Duplex>();
  let exited = false;
  let failed = false;
  // Set once READY arrived; a FATAL after it means the listener failed rather than never started.
  let path: string | undefined;
  void helper.exited.then(() => {
    exited = true;
    for (const stream of streams.values()) stream.destroy();
    streams.clear();
  });
  const send = (bytes: Buffer): void => {
    if (!exited && !helper.channel.destroyed) helper.channel.write(bytes);
  };

  const ready = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The control pipe's helper didn't create the pipe in time.")),
      READY_MS,
    );
    let pending: Buffer = Buffer.alloc(0);
    helper.channel.on("data", (chunk: Buffer) => {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      while (pending.length >= 9) {
        const length = pending.readUInt32LE(5);
        if (pending.length < 9 + length) break;
        const id = pending.readUInt32LE(0);
        const kind = pending[4];
        const payload = pending.subarray(9, 9 + length);
        pending = pending.subarray(9 + length);
        if (kind === READY) {
          clearTimeout(timer);
          // Recorded here, not after the await: a FATAL in the same chunk must see it.
          path = payload.toString("utf8");
          resolve(path);
        } else if (kind === FATAL) {
          clearTimeout(timer);
          const why = `The control pipe can't be served: ${payload.toString("utf8")}`;
          if (path === undefined) {
            reject(new Error(why));
          } else {
            // Ready earlier, failed since (no further instance could be created): the endpoint
            // is unusable though the helper lives, so the listener is no longer intact and is
            // replaced by the server's next check (D81 item 4).
            failed = true;
            void helper.stop();
          }
        } else if (kind === OPEN) {
          const stream = clientStream(id, send, () => streams.delete(id));
          streams.set(id, stream);
          onConnection(stream);
        } else if (kind === DATA) {
          // A copy: the chunk's buffer is reused by later frames.
          streams.get(id)?.push(Buffer.from(payload));
        } else if (kind === CLOSE) {
          const stream = streams.get(id);
          streams.delete(id);
          if (stream) {
            stream.push(null);
            stream.end();
          }
        }
      }
    });
    void helper.exited.then(() => {
      clearTimeout(timer);
      reject(new Error("The control pipe's helper exited."));
    });
  });
  helper.channel.on("error", () => {});
  let bound: string;
  try {
    bound = await ready;
  } catch (error) {
    await helper.stop();
    throw error;
  }
  return {
    path: bound,
    intact: () => !exited && !failed,
    async close() {
      // Every client's stream ends after what it was sent, in order on the one channel; then
      // connection 0's CLOSE asks the helper to hand all of it over and exit (at most its 5 s
      // drain). Only a helper that doesn't is stopped, which ends its job.
      for (const stream of streams.values()) stream.end();
      if (!exited) send(frame(0, CLOSE));
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        helper.exited,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, DRAIN_MS);
        }),
      ]);
      clearTimeout(timer);
      for (const stream of streams.values()) stream.destroy();
      streams.clear();
      await helper.stop();
    },
  };
}

/** One client's stream over the helper's channel. */
function clientStream(id: number, send: (bytes: Buffer) => void, forget: () => void): Duplex {
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    forget();
    send(frame(id, CLOSE));
  };
  return new Duplex({
    read() {},
    write(chunk: Buffer, _encoding, callback) {
      for (let offset = 0; offset < chunk.length; offset += MAX_FRAME) {
        send(frame(id, DATA, chunk.subarray(offset, offset + MAX_FRAME)));
      }
      callback();
    },
    final(callback) {
      close();
      callback();
    },
    destroy(error, callback) {
      close();
      callback(error);
    },
  });
}

/** Why a client couldn't open a control endpoint. */
export class ControlConnectError extends Error {
  /** `unreachable` (nothing serves it, or it timed out) or `not-owned` (another user's pipe). */
  readonly reason: "unreachable" | "not-owned";
  constructor(reason: "unreachable" | "not-owned", message: string) {
    super(message);
    this.name = "ControlConnectError";
    this.reason = reason;
  }
}

/**
 * Connects to a home's control endpoint as a client. On Windows through `mostra-win connect`,
 * which refuses a pipe another user created under the name (an old name `instance.json` still
 * names may be free for anyone to take), and never lets the server act as this process: Node.js
 * can check neither (Opus review of WP-W1). Rejects with a {@link ControlConnectError}.
 */
export function connectControl(endpoint: string, timeoutMs = 5000): Promise<Duplex> {
  return WINDOWS ? connectPipe(endpoint, timeoutMs) : connectSocket(endpoint, timeoutMs);
}

function connectSocket(path: string, timeoutMs: number): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection(path);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new ControlConnectError("unreachable", "timed out"));
    }, timeoutMs);
    socket.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new ControlConnectError("unreachable", error.code ?? "failed"));
    });
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
  });
}

function connectPipe(endpoint: string, timeoutMs: number): Promise<Duplex> {
  const name = endpoint.startsWith(PIPE_PREFIX) ? endpoint.slice(PIPE_PREFIX.length) : endpoint;
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath(), ["connect", name], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let settled = false;
    const fail = (reason: "unreachable" | "not-owned", message: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(new ControlConnectError(reason, message));
    };
    const timer = setTimeout(() => fail("unreachable", "timed out"), timeoutMs);
    child.once("error", (error) => fail("unreachable", error.message));
    child.once("exit", (code) => fail(code === 3 ? "not-owned" : "unreachable", `exit ${code}`));
    let text = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (settled) return;
      text += chunk;
      const end = text.indexOf("\n");
      if (end < 0) return;
      let line: { connected?: boolean; code?: string; error?: string } = {};
      try {
        line = JSON.parse(text.slice(0, end)) as typeof line;
      } catch {
        // Treated as a failure below.
      }
      if (line.connected !== true) {
        fail(
          line.code === "not-owned" ? "not-owned" : "unreachable",
          line.error ?? text.slice(0, end),
        );
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(Duplex.from({ readable: child.stdout, writable: child.stdin }));
    });
  });
}
