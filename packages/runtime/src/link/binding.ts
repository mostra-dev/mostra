/**
 * The owner's side of the network binding (INTERFACES §18.2, D165 item 2): one WebSocket to a
 * remote server's `/host`, dialled out (so it works behind NAT), opened with the access token and
 * the subprotocol `mostra.host`, carrying the host protocol as one JSON-RPC message per text frame.
 * It keeps the heartbeat (a ping and `mostra/ping` every 20 s; dead after 45 s of silence) and
 * dials again with backoff (1 s doubling to 60 s, with jitter) whenever the connection ends, so an
 * edge or server restart is an ordinary reconnect. Each connection opens its session afresh:
 * `mostra/initialize` with the owner link, then the ports registered again.
 */
import {
  HOST_PROTOCOL_REVISIONS,
  type JsonRpcParams,
  type MethodDefinition,
  type MostraInitializeParams,
  type MostraInitializeResult,
  mostraInitializeMethod,
  RpcPeer,
} from "@mostra/protocol";
import { WebSocket } from "ws";
import type { Log } from "../log.ts";
import {
  BINDING_SUBPROTOCOL,
  type HeartbeatOptions,
  keepAlive,
  MAX_FRAME_BYTES,
  readFrame,
} from "../protocol-server/index.ts";

/** The first redial's delay; each later one doubles, up to {@link MAX_REDIAL_MS}. */
export const FIRST_REDIAL_MS = 1_000;
/** The longest delay between dials (§18.2). */
export const MAX_REDIAL_MS = 60_000;

/** The delay before dial number `attempt` (1 for the first redial), with up to 25% jitter. */
export function redialMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_REDIAL_MS, FIRST_REDIAL_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.75 + random() * 0.25));
}

/** What a binding needs for each connection it opens. */
export interface BindingOptions {
  /** The server's API origin; the binding dials `<origin>/host` (`ws:` for `http:`, `wss:` for `https:`). */
  readonly server: string;
  /** A fresh access token for each dial (it may refresh it first). */
  readonly accessToken: () => Promise<string>;
  /** The `mostra/initialize` params for each session (the owner link with its marks, the ports). */
  readonly initialize: () => MostraInitializeParams;
  /** Requests the hosted home sends this instance: its port calls. */
  readonly onRequest: (method: string, params: unknown) => unknown;
  /**
   * Notifications the hosted home sends, with the session they came on: one can arrive while the
   * session's own start (`onOpen`) is still under way, before {@link Binding.session} names it
   * (Opus review of WP-29, 2).
   */
  readonly onNotification?: (method: string, params: unknown, session: BindingSession) => void;
  /** Runs once a session is open, before anything else is sent on it. */
  readonly onOpen?: (session: BindingSession) => void | Promise<void>;
  /** Runs when a connection ends, with why. */
  readonly onClose?: (reason: string) => void;
  /** Told when a dial is refused for its token (401): the caller signs in again or refreshes. */
  readonly onUnauthorized?: () => void;
  readonly log: Log;
  readonly heartbeat?: HeartbeatOptions;
  /** The `Host` to send, for tests that dial a loopback address under a name. */
  readonly connectTo?: { readonly host: string; readonly port?: number | undefined };
  /**
   * Sees every message the binding sends and receives, as its text (tests: the relay's secrets
   * grep, `MOSTRA_TEST_BINDING_TRACE`).
   */
  readonly trace?: (direction: "out" | "in", text: string) => void;
}

/** One open session on a binding. */
export interface BindingSession {
  readonly result: MostraInitializeResult;
  call<P, R>(
    definition: MethodDefinition<P, R>,
    params: P,
    options?: { timeoutMs?: number },
  ): Promise<R>;
  notify(method: string, params?: JsonRpcParams): void;
}

/** A binding that keeps itself connected until it is stopped. */
export interface Binding {
  /** The session open now, if any. */
  readonly session: BindingSession | undefined;
  /** Settles with the next open session (now, if one is open). */
  ready(): Promise<BindingSession>;
  /** Drops the current connection; the binding dials again (tests, a token change). */
  reconnect(): void;
  stop(): Promise<void>;
}

/** Starts a binding: it dials at once and keeps dialling until stopped. */
export function startBinding(options: BindingOptions): Binding {
  const { log } = options;
  let stopped = false;
  let current: { socket: WebSocket; peer: RpcPeer } | undefined;
  let session: BindingSession | undefined;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let waiters: ((session: BindingSession) => void)[] = [];

  const url = (): string => {
    const origin = new URL(options.server);
    const scheme = origin.protocol === "https:" ? "wss:" : "ws:";
    if (options.connectTo) {
      const port =
        options.connectTo.port ?? (Number(origin.port) || (scheme === "wss:" ? 443 : 80));
      return `${scheme}//${options.connectTo.host}:${port}/host`;
    }
    return `${scheme}//${origin.host}/host`;
  };

  const schedule = (): void => {
    if (stopped || timer) return;
    attempt += 1;
    const delay = redialMs(attempt);
    timer = setTimeout(() => {
      timer = undefined;
      void dial();
    }, delay);
    timer.unref?.();
  };

  const dial = async (): Promise<void> => {
    if (stopped) return;
    let token: string;
    try {
      token = await options.accessToken();
    } catch (error) {
      log.warn("link.token_failed", { server: options.server, error: (error as Error).message });
      options.onClose?.((error as Error).message);
      schedule();
      return;
    }
    if (stopped) return;
    const host = new URL(options.server).host;
    const socket = new WebSocket(url(), BINDING_SUBPROTOCOL, {
      headers: { authorization: `Bearer ${token}`, ...(options.connectTo ? { host } : {}) },
      maxPayload: MAX_FRAME_BYTES,
      perMessageDeflate: false,
      handshakeTimeout: 20_000,
    });
    let opened = false;
    /** This connection's session, from its `mostra/initialize` answer on. */
    let connectionSession: BindingSession | undefined;
    const peer = new RpcPeer({
      send: (message) => {
        if (socket.readyState !== socket.OPEN) return;
        const text = JSON.stringify(message);
        options.trace?.("out", text);
        socket.send(text);
      },
      onRequest: (method, params) => options.onRequest(method, params),
      onNotification: (method, params) => {
        if (method === "mostra/ping") return;
        if (!connectionSession) {
          log.warn("link.notification_before_session", { server: options.server, method });
          return;
        }
        options.onNotification?.(method, params, connectionSession);
      },
      onInternalError: (error, method) => log.error("link.internal_error", { method, error }),
    });
    current = { socket, peer };
    socket.on("unexpected-response", (_request, response) => {
      const status = response.statusCode ?? 0;
      log.warn("link.refused", { server: options.server, status });
      if (status === 401) options.onUnauthorized?.();
      socket.terminate();
    });
    socket.on("message", (data, isBinary) => {
      const text = readFrame(socket, data as Buffer, isBinary, log);
      if (text === undefined) return;
      options.trace?.("in", text);
      peer.receiveLine(text);
    });
    socket.on("error", (error) =>
      log.warn("link.socket_error", { server: options.server, error: error.message }),
    );
    socket.once("close", (code, reason) => {
      peer.close();
      if (current?.socket === socket) current = undefined;
      session = undefined;
      const why = `closed (${code}${reason.length > 0 ? `: ${reason.toString()}` : ""})`;
      if (opened) log.info("link.disconnected", { server: options.server, code });
      options.onClose?.(why);
      if (code === 4401 || code === 4403) options.onUnauthorized?.();
      schedule();
    });
    socket.once("open", () => {
      opened = true;
      keepAlive(socket, options.heartbeat);
      void (async () => {
        try {
          const result = await peer.call(mostraInitializeMethod, options.initialize(), {
            timeoutMs: 30_000,
          });
          const open: BindingSession = {
            result,
            call: (definition, params, callOptions) => peer.call(definition, params, callOptions),
            notify: (method, params) => peer.notify(method, params),
          };
          connectionSession = open;
          attempt = 0;
          await options.onOpen?.(open);
          if (socket.readyState !== socket.OPEN) return;
          session = open;
          log.info("link.connected", { server: options.server });
          const ready = waiters;
          waiters = [];
          for (const resolve of ready) resolve(open);
        } catch (error) {
          log.warn("link.initialize_failed", {
            server: options.server,
            error: (error as Error).message,
          });
          options.onClose?.((error as Error).message);
          socket.close(1008, "initialize failed");
        }
      })();
    });
  };

  void dial();

  return {
    get session() {
      return session;
    },
    ready() {
      if (session) return Promise.resolve(session);
      return new Promise((resolve) => waiters.push(resolve));
    },
    reconnect() {
      current?.socket.terminate();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      const open = current;
      current = undefined;
      if (open) {
        await new Promise<void>((resolve) => {
          if (open.socket.readyState === open.socket.CLOSED) {
            resolve();
            return;
          }
          open.socket.once("close", () => resolve());
          open.socket.close(1000);
          setTimeout(() => {
            open.socket.terminate();
            resolve();
          }, 2_000).unref();
        });
      }
    },
  };
}

/** The `mostra/initialize` params an owner instance sends on its binding (§18.2). */
export function ownerInitialize(input: {
  readonly name: string;
  readonly version: string;
  readonly instanceId: string;
  readonly relayMark: number;
  readonly followed?: { readonly incarnation: string; readonly cursor: string };
}): MostraInitializeParams {
  return {
    client: { name: input.name, version: input.version },
    revisions: [...HOST_PROTOCOL_REVISIONS],
    capabilities: { notifications: ["events/notify"] },
    ports: ["submissions", "relay"],
    link: {
      instanceId: input.instanceId,
      relayMark: input.relayMark,
      ...(input.followed
        ? {
            followed: {
              incarnation: input.followed.incarnation,
              cursor: input.followed.cursor as never,
            },
          }
        : {}),
    },
  };
}
