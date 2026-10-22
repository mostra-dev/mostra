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
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, type Stats, statSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { Duplex } from "node:stream";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import { type OperatingSystem, OS, socketPathLimit, WINDOWS } from "./directories.ts";

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
  /** Stops serving and removes what it created. Existing client streams are the caller's. */
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
  const path = join(runtimeDir, `${hash}.sock`);
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

/** Binds `endpoint` and calls `onConnection` for every client. */
export function listenControl(
  endpoint: string,
  onConnection: OnConnection,
  launchPipe: LaunchPipe | undefined,
): Promise<ControlListener> {
  if (WINDOWS) {
    if (!launchPipe) throw new Error("A Windows control pipe needs the helper's launcher.");
    return listenPipe(endpoint, onConnection, launchPipe);
  }
  return listenSocket(endpoint, onConnection);
}

async function listenSocket(path: string, onConnection: OnConnection): Promise<ControlListener> {
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
  server.on("error", () => {});
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
  const name = `${base.slice("\\\\.\\pipe\\".length)}-${randomBytes(8).toString("hex")}`;
  const helper = await launchPipe(name);
  const streams = new Map<number, Duplex>();
  let exited = false;
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
          resolve(payload.toString("utf8"));
        } else if (kind === FATAL) {
          clearTimeout(timer);
          reject(new Error(`The control pipe can't be served: ${payload.toString("utf8")}`));
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
  let path: string;
  try {
    path = await ready;
  } catch (error) {
    await helper.stop();
    throw error;
  }
  return {
    path,
    intact: () => !exited,
    async close() {
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
