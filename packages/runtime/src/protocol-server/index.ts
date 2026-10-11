/**
 * The host protocol server (HO-02, D59): one dispatcher for stdio and the home socket, the
 * session methods, and the socket client a starter uses to attach.
 */
import {
  type ChildProcessStatus,
  createDiagnostic,
  type InstanceInfo,
  type InstanceStatusResult,
  instanceStatusMethod,
  mostraShutdownMethod,
  RpcError,
} from "@mostra/protocol";
import { handler, type MethodHandler } from "./server.ts";

export { attach, type SocketClient } from "./client.ts";
export { handler, type MethodHandler, ProtocolServer } from "./server.ts";

/** What the session methods need from the instance. */
export interface SessionMethodsOptions {
  describe(): InstanceInfo;
  /** When the instance took ownership of its home. */
  readonly startedAt: string;
  socketPath(): string;
  connections(): number;
  processes(): readonly ChildProcessStatus[];
  /**
   * Stops the instance. Called after the `mostra/shutdown` response is on its way (D87).
   */
  shutdown(reason: string): void;
}

/** The handlers of `instance/status` and `mostra/shutdown`. */
export function sessionMethods(options: SessionMethodsOptions): MethodHandler[] {
  return [
    handler(
      instanceStatusMethod,
      (): InstanceStatusResult => ({
        instance: options.describe(),
        startedAt: options.startedAt,
        socket: options.socketPath(),
        connections: options.connections(),
        processes: [...options.processes()],
      }),
    ),
    handler(mostraShutdownMethod, (_params, session) => {
      // A host-spawned instance lives as long as its host's stdio; attached clients can't end it
      // (D87). A daemon stops for any attached client: its socket is owner-only.
      if (options.describe().mode === "host" && session.kind !== "stdio") {
        throw new RpcError(
          createDiagnostic("MOSTRA_HOST_SHUTDOWN_REFUSED", {
            message: "This instance was spawned by a host over stdio; only that host can stop it.",
          }),
        );
      }
      // Answer first: the response is written before the stop begins.
      setImmediate(() =>
        options.shutdown(`mostra/shutdown from ${session.client?.name ?? "a client"}`),
      );
      return {};
    }),
  ];
}
