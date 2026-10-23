/**
 * The client end of the home socket, used by a starter that finds another supervisor holding the
 * home (D81) and by tests. SDKs and the CLI implement the same few steps in their own packages.
 */
import {
  type ClientInfo,
  createDiagnostic,
  HOST_PROTOCOL_REVISIONS,
  type MostraInitializeResult,
  mostraInitializeMethod,
  RpcError,
  RpcPeer,
} from "@mostra/protocol";
import { ControlConnectError, connectControl } from "../platform/index.ts";
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
 * listens there (the file is missing or stale), the connection doesn't open within `timeoutMs`,
 * or, on Windows, the pipe under that name is another user's.
 */
export function connectSocket(path: string, timeoutMs = 5000): Promise<SocketClient> {
  return connectControl(path, timeoutMs).then(
    (socket) => {
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
      return {
        peer,
        closed,
        close: () => {
          peer.close();
          socket.end();
        },
      };
    },
    (error: unknown) => {
      // Another user's pipe under the name is no instance of this home, like no instance at all.
      const why =
        error instanceof ControlConnectError && error.reason === "not-owned"
          ? "it belongs to another user"
          : error instanceof Error
            ? error.message
            : "failed";
      throw refused(path, why);
    },
  );
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
