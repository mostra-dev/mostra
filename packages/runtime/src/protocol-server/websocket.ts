/**
 * The host protocol over WebSocket (INTERFACES §18.2, D165 item 2): the network binding between an
 * owner instance and its hosted home. One JSON-RPC message per text frame, at most
 * `MAX_LINE_LENGTH` characters, checked on both sides; a binary frame closes the connection
 * (1003), a longer message too (1009). Each side sends a WebSocket ping and the notification
 * `mostra/ping` every 20 s, since some proxies count only data as activity, and closes a
 * connection it heard nothing on for 45 s, inside the 60 s idle limit of the edges a server sits
 * behind (VERIFIED_FACTS, WP-28).
 *
 * The server side adapts a socket to {@link ProtocolServer.serve}'s line streams, so every rule of
 * the host protocol (initialize first, revisions, `requestId`s, port calls on the registering
 * connection) is the same code as stdio and the home socket.
 */
import { PassThrough, Writable } from "node:stream";
import { MAX_LINE_LENGTH } from "@mostra/protocol";
import type { WebSocket } from "ws";
import type { Log } from "../log.ts";
import type { ProtocolServer, Session } from "./server.ts";

/** The subprotocol a binding asks for (`Sec-WebSocket-Protocol`). */
export const BINDING_SUBPROTOCOL = "mostra.host";

/** How often each side pings, and how long a silent connection lives. */
export const HEARTBEAT = { intervalMs: 20_000, silenceMs: 45_000 } as const;

/** The largest frame a binding accepts, in bytes: a message's characters can take 4 bytes each. */
export const MAX_FRAME_BYTES: number = MAX_LINE_LENGTH * 4;

/** The JSON-RPC heartbeat beside the WebSocket ping (a notification nobody answers). */
const PING_LINE = JSON.stringify({ jsonrpc: "2.0", method: "mostra/ping" });

/** Options for {@link keepAlive}. */
export interface HeartbeatOptions {
  readonly intervalMs?: number;
  readonly silenceMs?: number;
  /** Told when the connection is closed for its silence. */
  readonly onSilent?: () => void;
}

/**
 * Keeps a binding alive and judges it: pings each way every interval, and terminates the
 * connection once nothing (a message, a ping or a pong) arrived for the silence limit. Returns a
 * function that stops it; it stops by itself when the socket closes.
 */
export function keepAlive(socket: WebSocket, options: HeartbeatOptions = {}): () => void {
  const intervalMs = options.intervalMs ?? HEARTBEAT.intervalMs;
  const silenceMs = options.silenceMs ?? HEARTBEAT.silenceMs;
  let heard = Date.now();
  const hear = (): void => {
    heard = Date.now();
  };
  socket.on("message", hear);
  socket.on("ping", hear);
  socket.on("pong", hear);
  const check = setInterval(
    () => {
      if (socket.readyState !== socket.OPEN) return;
      if (Date.now() - heard >= silenceMs) {
        options.onSilent?.();
        socket.terminate();
        return;
      }
    },
    Math.min(1_000, Math.max(50, silenceMs / 10)),
  );
  const ping = setInterval(() => {
    if (socket.readyState !== socket.OPEN) return;
    socket.ping();
    socket.send(PING_LINE);
  }, intervalMs);
  check.unref();
  ping.unref();
  const stop = (): void => {
    clearInterval(check);
    clearInterval(ping);
  };
  socket.once("close", stop);
  return stop;
}

/**
 * Checks one frame and returns its text, or closes the socket and returns `undefined`: binary
 * frames close it with 1003, a message longer than the limit with 1009.
 */
export function readFrame(
  socket: WebSocket,
  data: Buffer | ArrayBuffer | Buffer[],
  isBinary: boolean,
  log?: Log,
): string | undefined {
  if (isBinary) {
    log?.warn("binding.binary_frame", {});
    socket.close(1003, "binary frames are not part of the binding");
    return undefined;
  }
  const text = Array.isArray(data)
    ? Buffer.concat(data).toString("utf8")
    : Buffer.from(data as ArrayBuffer).toString("utf8");
  if (text.includes("\n")) {
    log?.warn("binding.frame_with_newline", {});
    socket.close(1007, "one message per frame");
    return undefined;
  }
  if (text.length > MAX_LINE_LENGTH) {
    log?.warn("binding.message_too_large", {
      code: "MOSTRA_HOST_MESSAGE_TOO_LARGE",
      length: text.length,
    });
    socket.close(1009, "message too large");
    return undefined;
  }
  return text;
}

/**
 * Serves one binding connection with `server`: frames in become lines, lines out become frames.
 * The heartbeat is kept; `attributes` (the account and grant the access token named) are the
 * session's. Returns the session.
 */
export function serveWebSocket(
  server: ProtocolServer,
  socket: WebSocket,
  options: {
    readonly attributes: Readonly<Record<string, unknown>>;
    readonly log: Log;
    readonly heartbeat?: HeartbeatOptions;
    readonly onClose?: () => void;
  },
): Session {
  const input = new PassThrough();
  const output = new Writable({
    write(chunk: Buffer | string, _encoding, done): void {
      const text = (typeof chunk === "string" ? chunk : chunk.toString("utf8")).replace(/\n$/, "");
      if (socket.readyState !== socket.OPEN) {
        done();
        return;
      }
      socket.send(text, (error) => done(error ?? null));
    },
    final(done): void {
      if (socket.readyState === socket.OPEN) socket.close(1000);
      done();
    },
  });
  output.on("error", () => {});
  socket.on("message", (data, isBinary) => {
    const text = readFrame(socket, data as Buffer, isBinary, options.log);
    if (text === undefined) return;
    if (text === PING_LINE) return;
    input.write(`${text}\n`);
  });
  socket.once("close", () => {
    input.end();
  });
  socket.on("error", (error) => options.log.warn("binding.socket_error", { error }));
  keepAlive(socket, {
    ...options.heartbeat,
    onSilent: () => options.log.warn("binding.silent", {}),
  });
  return server.serve("websocket", input, output, options.onClose, options.attributes);
}
