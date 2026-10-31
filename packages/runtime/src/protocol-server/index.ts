/**
 * The host protocol server (HO-02, D59): one dispatcher for stdio and the home socket, the
 * session methods, and the socket client a starter uses to attach.
 */
import {
  type ChildProcessStatus,
  createDiagnostic,
  type DeliveryCounts,
  type GatewayStatus,
  type InstanceCheck,
  type InstanceInfo,
  type InstanceStatusResult,
  instanceCheckMethod,
  instanceStatusMethod,
  mostraShutdownMethod,
  RpcError,
  type Share,
  type WorkerStatus,
} from "@mostra/protocol";
import { handler, type MethodHandler } from "./server.ts";

export { attach, type SocketClient } from "./client.ts";
export { handler, type MethodHandler, ProtocolServer, type Session } from "./server.ts";

/** What the session methods need from the instance. */
export interface SessionMethodsOptions {
  describe(): InstanceInfo;
  /** When the instance took ownership of its home. */
  readonly startedAt: string;
  socketPath(): string;
  connections(): number;
  processes(): readonly ChildProcessStatus[];
  /** Where the gateway listens, once it has started. */
  gateway?(): GatewayStatus | undefined;
  /** The outbox per host (WP-06). */
  deliveries?(): readonly DeliveryCounts[];
  /** The artifact workers (WP-08). */
  workers?(): readonly WorkerStatus[];
  /** When an idle daemon exits (WP-08); `undefined` while busy or for an instance that never does. */
  idleExitAt?(): string | undefined;
  /** The active shares (WP-13, D158). */
  shares?(): readonly Share[];
  /**
   * The supervisor's own checks of its home (`instance/check`, D140 item 18), in order; `deep`
   * also hashes every version against its output digest.
   */
  checks?(deep: boolean): Promise<readonly InstanceCheck[]>;
  /**
   * Stops the instance. Called after the `mostra/shutdown` response is on its way (D87).
   */
  shutdown(reason: string): void;
}

/** The handlers of `instance/status` and `mostra/shutdown`. */
export function sessionMethods(options: SessionMethodsOptions): MethodHandler[] {
  return [
    handler(instanceStatusMethod, (): InstanceStatusResult => {
      const gateway = options.gateway?.();
      return {
        instance: options.describe(),
        startedAt: options.startedAt,
        socket: options.socketPath(),
        connections: options.connections(),
        processes: [...options.processes()],
        ...(gateway ? { gateway } : {}),
        ...(options.deliveries ? { deliveries: [...options.deliveries()] } : {}),
        ...(options.workers ? { workers: [...options.workers()] } : {}),
        ...(options.shares ? { shares: [...options.shares()] } : {}),
        ...(() => {
          const at = options.idleExitAt?.();
          return at === undefined ? {} : { idleExitAt: at };
        })(),
      };
    }),
    handler(instanceCheckMethod, async (params) => ({
      checks: [...((await options.checks?.(params.deep === true)) ?? [])],
    })),
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
