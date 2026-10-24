/**
 * The child side of supervisor messaging, for Node children the process manager starts with an
 * IPC channel. It wires the JSON-RPC core to Node IPC and keeps the rule that a child never
 * outlives its supervisor: when the channel disconnects (the supervisor exited or was killed), the
 * child signals its own process group, so grandchildren go too, and exits (FAILURE_MODEL §2).
 *
 * ```ts
 * const supervisor = connectToSupervisor({ onRequest: (method, params) => handle(method, params) });
 * await supervisor.request("child/adopt", { pid: pty.pid }); // a program in its own session
 * ```
 */
import { type JsonRpcParams, RpcPeer } from "@mostra/protocol";
import { WINDOWS } from "../platform/index.ts";

/** Options for {@link connectToSupervisor}. */
export interface SupervisorConnectionOptions {
  /** Answers the supervisor's requests. */
  readonly onRequest?: (method: string, params: unknown) => unknown;
  /** Receives the supervisor's notifications. */
  readonly onNotification?: (method: string, params: unknown) => void;
}

/** The child's end of the connection. */
export interface SupervisorConnection {
  /** Sends a request to the supervisor, such as `child/adopt`. */
  request(method: string, params?: JsonRpcParams): Promise<unknown>;
  /** Sends a notification to the supervisor. */
  notify(method: string, params?: JsonRpcParams): void;
}

/**
 * Connects a Node child to its supervisor over the IPC channel.
 *
 * @throws Error when the process wasn't started with an IPC channel.
 */
export function connectToSupervisor(
  options: SupervisorConnectionOptions = {},
): SupervisorConnection {
  const send = process.send?.bind(process);
  if (!send)
    throw new Error("This process wasn't started by a Mostra supervisor (no IPC channel).");
  const peer = new RpcPeer({
    send: (message) => {
      send(message);
    },
    ...(options.onRequest ? { onRequest: options.onRequest } : {}),
    ...(options.onNotification ? { onNotification: options.onNotification } : {}),
  });
  process.on("message", (message) => peer.receive(message));
  process.on("disconnect", () => {
    peer.close();
    exitWithGroup();
  });
  return {
    request: (method, params) => peer.request(method, params),
    notify: (method, params) => peer.notify(method, params),
  };
}

/**
 * Signals this child's whole process group (it leads it) and exits. On Windows there is no group
 * to signal: the child's gate ends its Job Object, descendants included, once the child exits.
 */
function exitWithGroup(): void {
  if (!WINDOWS) {
    try {
      process.kill(-process.pid, "SIGTERM");
    } catch {
      // The group is already gone.
    }
  }
  process.exit(0);
}
