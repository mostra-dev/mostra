/**
 * The host protocol server (D59, INTERFACES §6, HO-02): one dispatcher for every connection,
 * whether `mostra-runtime host`'s stdio or an attached client's Unix socket. It owns the session
 * rules (initialize first and once, revision negotiation, the home check, port registration on
 * the registering connection) and routes every other method to the handler a module registered.
 */
import { chmodSync, mkdirSync, type Stats, statSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import type { Readable, Writable } from "node:stream";
import {
  type ClientInfo,
  createDiagnostic,
  type Diagnostic,
  HOST_PROTOCOL_REVISIONS,
  type HomeConfig,
  type InstanceInfo,
  type JsonRpcParams,
  type MethodDefinition,
  type MostraInitializeResult,
  mostraInitializeMethod,
  negotiateRevision,
  parseParams,
  type Revision,
  RpcError,
  RpcPeer,
} from "@mostra/protocol";
import type { Log } from "../log.ts";
import { pump, writeLine } from "./streams.ts";

/** How a connection reached the instance. */
export type ConnectionKind = "stdio" | "socket";

/** One connection's session, as handlers see it. */
export interface Session {
  /** A per-instance sequence number, for logs. */
  readonly id: number;
  readonly kind: ConnectionKind;
  /** The client, once initialized. */
  readonly client: ClientInfo | undefined;
  /** The negotiated revision, once initialized. */
  readonly revision: Revision | undefined;
  /** The ports this connection registered and the instance supports. */
  readonly ports: ReadonlySet<string>;
}

/** A method a module serves. */
export interface MethodHandler<P = unknown, R = unknown> {
  readonly definition: MethodDefinition<P, R>;
  handle(params: P, session: Session): R | Promise<R>;
}

/** Builds a handler with its types checked against the method definition. */
export function handler<P, R>(
  definition: MethodDefinition<P, R>,
  handle: (params: P, session: Session) => R | Promise<R>,
): MethodHandler {
  return { definition, handle } as unknown as MethodHandler;
}

/** Options for {@link ProtocolServer}. */
export interface ProtocolServerOptions {
  readonly log: Log;
  /** Describes the instance for `mostra/initialize`. */
  describe(): InstanceInfo;
  /** Whether a client's `home.path` names this instance's home (D84). */
  servesHome(path: string): boolean;
  /**
   * Applies a client's home settings (`HomeConfig` without `path`), such as the dependency policy
   * (D95). Runs during `mostra/initialize`, after the home check; a throw refuses the session.
   */
  configureHome?(home: HomeConfig): void;
  /** Every method besides `mostra/initialize`. */
  readonly handlers: readonly MethodHandler[];
  /** The ports this instance calls when a client registers them. */
  readonly supportedPorts: readonly string[];
  /** The revisions this instance speaks. Default: `HOST_PROTOCOL_REVISIONS`. */
  readonly revisions?: readonly Revision[];
  /**
   * Applied to the text of every diagnostic a response carries, so secrets and capability
   * material that reach an error (a bundler message quoting an import, say) never leave the
   * instance (STANDARDS security). Default: the identity.
   */
  readonly redact?: (text: string) => string;
}

interface Connection {
  readonly session: MutableSession;
  readonly peer: RpcPeer;
  close(): void;
}

interface MutableSession {
  id: number;
  kind: ConnectionKind;
  client: ClientInfo | undefined;
  revision: Revision | undefined;
  ports: Set<string>;
  initialized: boolean;
}

/** The host protocol server of one instance. */
export class ProtocolServer {
  readonly #options: ProtocolServerOptions;
  readonly #handlers: ReadonlyMap<string, MethodHandler>;
  readonly #connections = new Set<Connection>();
  #nextId = 1;
  #refusal: Diagnostic | undefined;
  #listener: { server: Server; path: string; stats: Stats } | undefined;
  #healTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: ProtocolServerOptions) {
    this.#options = options;
    this.#handlers = new Map(options.handlers.map((entry) => [entry.definition.method, entry]));
  }

  /** How many connections are open. */
  get connections(): number {
    return this.#connections.size;
  }

  /** The methods this server serves, for `capabilities.methods`. */
  get methods(): readonly string[] {
    return [mostraInitializeMethod.method, ...this.#handlers.keys()];
  }

  /**
   * Serves one stream connection (stdio, or an accepted socket). `onClose` runs once when it
   * ends.
   */
  serve(kind: ConnectionKind, input: Readable, output: Writable, onClose?: () => void): Session {
    const session: MutableSession = {
      id: this.#nextId++,
      kind,
      client: undefined,
      revision: undefined,
      ports: new Set(),
      initialized: false,
    };
    const peer = new RpcPeer({
      send: (message) => {
        writeLine(output, message);
      },
      onRequest: (method, params) => this.#dispatch(session, method, params),
      onInternalError: (error, method) =>
        this.#options.log.error("protocol.internal_error", { session: session.id, method, error }),
    });
    const connection: Connection = {
      session,
      peer,
      close: () => {
        peer.close();
        output.end();
      },
    };
    this.#connections.add(connection);
    this.#options.log.info("protocol.connected", { session: session.id, kind });
    pump(
      { input, output },
      () => peer,
      () => {
        peer.close();
        this.#connections.delete(connection);
        this.#options.log.info("protocol.disconnected", { session: session.id, kind });
        onClose?.();
      },
    );
    return session;
  }

  /**
   * Listens on the home's control socket (D81, D82): replaces any leftover socket file (only the
   * lock holder calls this), makes the socket owner-only, and checks every `healMs` (at most
   * 10 s) that the file still exists, re-creating it when it has disappeared.
   */
  async listen(path: string, healMs = 5000): Promise<void> {
    this.#listener = await this.#bind(path);
    this.#healTimer = setInterval(() => void this.#heal(), Math.min(healMs, 10_000));
    this.#healTimer.unref();
  }

  /** The socket the server listens on. */
  get socketPath(): string | undefined {
    return this.#listener?.path;
  }

  async #bind(path: string): Promise<{ server: Server; path: string; stats: Stats }> {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
      unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const server = createServer((socket: Socket) => {
      this.serve("socket", socket, socket);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path, () => {
        server.off("error", reject);
        resolve();
      });
    });
    chmodSync(path, 0o600);
    server.on("error", (error) => this.#options.log.error("protocol.listener_error", { error }));
    return { server, path, stats: statSync(path) };
  }

  async #heal(): Promise<void> {
    const listener = this.#listener;
    if (!listener) return;
    let current: Stats | undefined;
    try {
      current = statSync(listener.path);
    } catch {
      current = undefined;
    }
    if (current && current.ino === listener.stats.ino && current.dev === listener.stats.dev) return;
    // Close the old listener first: Node removes a Unix socket's file when its server closes, so
    // closing it after binding would remove the new socket.
    listener.server.close();
    try {
      const replacement = await this.#bind(listener.path);
      this.#listener = replacement;
      this.#options.log.warn("protocol.socket_recreated", { path: listener.path });
    } catch (error) {
      this.#options.log.warn("protocol.socket_recreate_failed", { path: listener.path, error });
    }
  }

  /**
   * Answers every request from now on with `diagnostic`, for an instance that can no longer serve
   * (`MOSTRA_HOME_GONE`).
   */
  refuse(diagnostic: Diagnostic): void {
    this.#refusal = diagnostic;
  }

  /**
   * Calls a port method on the connection that registered the port most recently (D59: port
   * callbacks reach only the registering connection).
   */
  callPort(
    port: string,
    method: string,
    params: JsonRpcParams,
    options: { timeoutMs?: number } = {},
  ): Promise<unknown> {
    const registrant = [...this.#connections]
      .reverse()
      .find((connection) => connection.session.ports.has(port));
    if (!registrant) return Promise.reject(new Error(`No connection registered the ${port} port.`));
    return registrant.peer.request(method, params, options);
  }

  /**
   * Stops listening, removes the socket file if it is still this server's, and closes every
   * connection. Responses already sent are flushed first.
   */
  close(): void {
    if (this.#healTimer) clearInterval(this.#healTimer);
    const listener = this.#listener;
    this.#listener = undefined;
    if (listener) {
      listener.server.close();
      try {
        const current = statSync(listener.path);
        if (current.ino === listener.stats.ino && current.dev === listener.stats.dev)
          unlinkSync(listener.path);
      } catch {
        // Already gone.
      }
    }
    for (const connection of this.#connections) connection.close();
  }

  async #dispatch(session: MutableSession, method: string, params: unknown): Promise<unknown> {
    try {
      return await this.#route(session, method, params);
    } catch (error) {
      const redact = this.#options.redact;
      if (!redact || !(error instanceof RpcError)) throw error;
      const { diagnostic } = error;
      throw new RpcError(
        {
          ...diagnostic,
          message: redact(diagnostic.message),
          ...(diagnostic.hint !== undefined ? { hint: redact(diagnostic.hint) } : {}),
          ...(diagnostic.fix?.text !== undefined
            ? { fix: { ...diagnostic.fix, text: redact(diagnostic.fix.text) } }
            : {}),
        },
        error.code,
      );
    }
  }

  async #route(session: MutableSession, method: string, params: unknown): Promise<unknown> {
    if (this.#refusal) throw new RpcError(this.#refusal);
    if (method === mostraInitializeMethod.method) return this.#initialize(session, params);
    if (!session.initialized) {
      throw new RpcError(
        createDiagnostic("MOSTRA_HOST_INITIALIZE_ORDER", {
          message: `${method} arrived before mostra/initialize on this connection.`,
        }),
      );
    }
    const entry = this.#handlers.get(method);
    if (!entry) {
      throw new RpcError(
        createDiagnostic("MOSTRA_HOST_METHOD_UNKNOWN", {
          message: `This instance serves no method ${method}.`,
        }),
      );
    }
    const parsed = parseParams(entry.definition, params);
    const result = await entry.handle(parsed, session);
    const checked = entry.definition.result.safeParse(result);
    if (!checked.success) {
      this.#options.log.error("protocol.invalid_result", { method, issues: checked.error.issues });
      throw new RpcError(
        createDiagnostic("MOSTRA_HOST_INTERNAL_ERROR", {
          message: `${method} failed unexpectedly.`,
        }),
      );
    }
    return checked.data;
  }

  #initialize(session: MutableSession, raw: unknown): MostraInitializeResult {
    if (session.initialized) {
      throw new RpcError(
        createDiagnostic("MOSTRA_HOST_INITIALIZE_ORDER", {
          message: "This connection is already initialized; mostra/initialize is sent once.",
        }),
      );
    }
    const params = parseParams(mostraInitializeMethod, raw);
    const negotiation = negotiateRevision(
      params.revisions,
      this.#options.revisions ?? HOST_PROTOCOL_REVISIONS,
    );
    if (!negotiation.ok) throw new RpcError(negotiation.diagnostic);
    const instance = this.#options.describe();
    if (params.home?.path !== undefined && !this.#options.servesHome(params.home.path)) {
      throw new RpcError(
        createDiagnostic("MOSTRA_HOME_MISMATCH", {
          message: `The client expects the home ${params.home.path}; this instance serves ${instance.home}.`,
        }),
      );
    }
    if (params.home !== undefined) this.#options.configureHome?.(params.home);
    const supported = new Set(this.#options.supportedPorts);
    const warnings: Diagnostic[] = [];
    for (const port of new Set(params.ports)) {
      if (supported.has(port)) {
        session.ports.add(port);
      } else {
        warnings.push(
          createDiagnostic("MOSTRA_HOST_PORT_UNSUPPORTED", {
            message:
              port === "ai"
                ? "The ai port is reserved for a later release (D46); this instance doesn't call it."
                : `This instance doesn't call the ${port} port; the session continues without it.`,
          }),
        );
      }
    }
    session.initialized = true;
    session.client = params.client;
    session.revision = negotiation.revision;
    this.#options.log.info("protocol.initialized", {
      session: session.id,
      client: params.client,
      revision: negotiation.revision,
      ports: [...session.ports],
    });
    return {
      revision: negotiation.revision,
      instance,
      capabilities: {
        methods: this.methods,
        notifications: [],
        ports: [...this.#options.supportedPorts],
      },
      warnings,
    };
  }
}
