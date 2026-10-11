/**
 * The client end of the home socket, used by a starter that finds another supervisor holding the
 * home (D81) and by tests. SDKs and the CLI implement the same few steps in their own packages.
 */
import { createConnection, type Socket } from "node:net";
import {
  type ClientInfo,
  createDiagnostic,
  HOST_PROTOCOL_REVISIONS,
  type MostraInitializeResult,
  mostraInitializeMethod,
  RpcError,
  RpcPeer,
} from "@mostra/protocol";
import { pump, writeLine } from "./streams.ts";

/** An open client connection to an instance's socket. */
export interface SocketClient {
  readonly peer: RpcPeer;
  /** Resolves when the connection has closed. */
  readonly closed: Promise<void>;
  close(): void;
}

/**
 * Connects to a control socket. Rejects with `MOSTRA_HOST_CONNECTION_CLOSED` when nothing
 * listens there (the file is missing or stale) or the connection doesn't open within `timeoutMs`.
 */
export function connectSocket(path: string, timeoutMs = 5000): Promise<SocketClient> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection(path);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(refused(path, "timed out"));
    }, timeoutMs);
    socket.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(refused(path, error.code ?? "failed"));
    });
    socket.once("connect", () => {
      clearTimeout(timer);
      const peer = new RpcPeer({ send: (message) => void writeLine(socket, message) });
      let markClosed: () => void = () => {};
      const closed = new Promise<void>((done) => {
        markClosed = done;
      });
      socket.on("error", () => socket.destroy());
      pump(
        { input: socket, output: socket },
        () => peer,
        () => {
          peer.close();
          markClosed();
        },
      );
      resolve({
        peer,
        closed,
        close: () => {
          peer.close();
          socket.end();
        },
      });
    });
  });
}

function refused(path: string, why: string): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_HOST_CONNECTION_CLOSED", {
      message: `Couldn't connect to the instance socket ${path} (${why}).`,
    }),
  );
}

/** Connects to a socket and opens a session. The caller closes the returned client. */
export async function attach(
  path: string,
  client: ClientInfo,
  timeoutMs = 5000,
): Promise<{ client: SocketClient; result: MostraInitializeResult }> {
  const connection = await connectSocket(path, timeoutMs);
  try {
    const result = await connection.peer.call(
      mostraInitializeMethod,
      { client, revisions: [...HOST_PROTOCOL_REVISIONS], capabilities: {}, ports: [] },
      { timeoutMs },
    );
    return { client: connection, result };
  } catch (error) {
    connection.close();
    throw error;
  }
}
