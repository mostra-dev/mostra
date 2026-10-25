/**
 * One end of a JSON-RPC 2.0 connection (D83): it matches responses to requests, dispatches
 * incoming requests and notifications, and turns every failure into a diagnostic. It has no I/O.
 * The transport hands it parsed messages (or raw lines) and sends what it gives back, so the same
 * peer serves stdio, Unix sockets, Node IPC and `postMessage`.
 *
 * ```ts
 * const peer = new RpcPeer({
 *   send: (message) => socket.write(encodeLine(message)),
 *   onRequest: (method, params) => handlers[method](params),
 * });
 * splitter.push(chunk).forEach((line) => peer.receiveLine(line));
 * const result = await peer.call(mostraInitializeMethod, params);
 * ```
 */
import type { Diagnostic } from "../diagnostics/diagnostic.ts";
import type { MethodDefinition } from "../method.ts";
import { receivable } from "../receive.ts";
import { hostDiagnostic, JSON_RPC_ERROR_CODES, RpcError } from "./error.ts";
import {
  classifyMessage,
  type JsonRpcId,
  type JsonRpcMessage,
  type JsonRpcParams,
} from "./messages.ts";

/** What a request handler learns about the request besides its params. */
export interface RpcRequestContext {
  /** The request's ID. */
  readonly id: JsonRpcId;
  /** The method name. */
  readonly method: string;
}

/** Options for {@link RpcPeer}. */
export interface RpcPeerOptions {
  /**
   * Sends one message. The transport serializes it (`encodeLine` for newline-delimited streams).
   * Throwing means the transport is gone: the peer closes.
   */
  send(message: JsonRpcMessage): void;
  /**
   * Answers an incoming request. Return the result, or throw an {@link RpcError} to answer with
   * its diagnostic. Any other exception is answered with `MOSTRA_HOST_INTERNAL_ERROR`, without
   * its details, and reported to `onInternalError`. Without a handler, every request is answered
   * with `MOSTRA_HOST_METHOD_UNKNOWN`.
   */
  onRequest?(method: string, params: unknown, context: RpcRequestContext): unknown;
  /** Receives an incoming notification. Exceptions are reported to `onInternalError`. */
  onNotification?(method: string, params: unknown): void;
  /** Reports an unexpected exception from a handler, for logging. */
  onInternalError?(error: unknown, method: string): void;
  /** The docs base URL for diagnostics the peer creates. Default `DEFAULT_DOCS_BASE`. */
  readonly docsBase?: string;
}

/** Options for one outgoing request. */
export interface RpcRequestOptions {
  /**
   * Gives up after this many milliseconds with `MOSTRA_HOST_TIMEOUT`. A late response is
   * ignored. Default: no timeout (FAILURE_MODEL §9).
   */
  readonly timeoutMs?: number;
}

interface Pending {
  readonly method: string;
  resolve(result: unknown): void;
  reject(error: RpcError): void;
  timer?: ReturnType<typeof setTimeout>;
}

/** One end of a JSON-RPC 2.0 connection. */
export class RpcPeer {
  readonly #options: RpcPeerOptions;
  readonly #pending = new Map<JsonRpcId, Pending>();
  #nextId = 1;
  #closed: Diagnostic | undefined;

  constructor(options: RpcPeerOptions) {
    this.#options = options;
  }

  /** Whether the peer has closed. A closed peer sends nothing and rejects new requests. */
  get closed(): boolean {
    return this.#closed !== undefined;
  }

  /** How many outgoing requests are waiting for a response. */
  get pendingRequests(): number {
    return this.#pending.size;
  }

  /**
   * Receives one line of a newline-delimited stream. Blank lines are skipped; a line that isn't
   * JSON is answered with a parse error (-32700).
   */
  receiveLine(line: string): void {
    if (line.trim() === "") return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.#reply(null, {
        rpc: new RpcError(
          this.#diagnostic("MOSTRA_HOST_MALFORMED", "A line wasn't valid JSON."),
          JSON_RPC_ERROR_CODES.parseError,
        ),
      });
      return;
    }
    this.receive(value);
  }

  /** Receives one parsed message. */
  receive(value: unknown): void {
    if (this.#closed) return;
    const classified = classifyMessage(value);
    switch (classified.kind) {
      case "request":
        this.#handleRequest(
          classified.message.id,
          classified.message.method,
          classified.message.params,
        );
        return;
      case "notification":
        this.#handleNotification(classified.message.method, classified.message.params);
        return;
      case "success":
        this.#settle(classified.message.id, (pending) =>
          pending.resolve(classified.message.result),
        );
        return;
      case "failure": {
        const { id, error } = classified.message;
        if (id !== null) {
          this.#settle(id, (pending) =>
            pending.reject(RpcError.fromErrorObject(error, this.#options.docsBase)),
          );
        }
        return;
      }
      case "invalid":
        this.#reply(classified.id, {
          rpc: new RpcError(this.#diagnostic("MOSTRA_HOST_MALFORMED", classified.reason)),
        });
        return;
    }
  }

  /**
   * Sends a request and resolves with its result, or rejects with an {@link RpcError}: the
   * other side's diagnostic, `MOSTRA_HOST_TIMEOUT` or `MOSTRA_HOST_CONNECTION_CLOSED`.
   */
  request(
    method: string,
    params?: JsonRpcParams,
    options: RpcRequestOptions = {},
  ): Promise<unknown> {
    if (this.#closed) return Promise.reject(new RpcError(this.#closed));
    const id = this.#nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const pending: Pending = { method, resolve, reject };
      if (options.timeoutMs !== undefined) {
        pending.timer = setTimeout(() => {
          this.#pending.delete(id);
          reject(
            new RpcError(
              this.#diagnostic(
                "MOSTRA_HOST_TIMEOUT",
                `No response to ${method} within ${options.timeoutMs} ms.`,
              ),
            ),
          );
        }, options.timeoutMs);
      }
      this.#pending.set(id, pending);
      this.#send(
        params === undefined
          ? { jsonrpc: "2.0", id, method }
          : { jsonrpc: "2.0", id, method, params },
      );
    });
  }

  /**
   * Calls a protocol method: validates the params before sending and the result on arrival. A
   * result that fails the method's schema rejects with `MOSTRA_HOST_MALFORMED`. The result is
   * read as {@link receivable} reads it, so an enum value or union member a newer peer added
   * within the revision arrives as sent (#45).
   */
  async call<P, R>(
    definition: MethodDefinition<P, R>,
    params: P,
    options: RpcRequestOptions = {},
  ): Promise<R> {
    const checked = parseParams(definition, params, this.#options.docsBase);
    const raw = await this.request(definition.method, checked as JsonRpcParams, options);
    const parsed = receivable(definition.result).safeParse(raw);
    if (parsed.success) return parsed.data;
    throw new RpcError(
      this.#diagnostic(
        "MOSTRA_HOST_MALFORMED",
        `The result of ${definition.method} doesn't match its schema: ${describeIssue(parsed.error.issues)}`,
      ),
    );
  }

  /** Sends a notification. Does nothing once the peer is closed. */
  notify(method: string, params?: JsonRpcParams): void {
    if (this.#closed) return;
    this.#send(
      params === undefined ? { jsonrpc: "2.0", method } : { jsonrpc: "2.0", method, params },
    );
  }

  /**
   * Closes the peer: every waiting request rejects with `diagnostic` (by default
   * `MOSTRA_HOST_CONNECTION_CLOSED`), and later messages are ignored. Idempotent.
   */
  close(diagnostic?: Diagnostic): void {
    if (this.#closed) return;
    const reason =
      diagnostic ??
      this.#diagnostic(
        "MOSTRA_HOST_CONNECTION_CLOSED",
        "The connection closed before a response arrived.",
      );
    this.#closed = reason;
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const entry of pending) {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      entry.reject(new RpcError(reason));
    }
  }

  #handleRequest(id: JsonRpcId, method: string, params: unknown): void {
    const handler = this.#options.onRequest;
    if (!handler) {
      this.#reply(id, {
        rpc: new RpcError(
          this.#diagnostic("MOSTRA_HOST_METHOD_UNKNOWN", `This side serves no method ${method}.`),
        ),
      });
      return;
    }
    let outcome: unknown;
    try {
      outcome = handler(method, params, { id, method });
    } catch (error) {
      this.#reply(id, { rpc: this.#asRpcError(error, method) });
      return;
    }
    Promise.resolve(outcome).then(
      (result) => this.#reply(id, { result: result === undefined ? null : result }),
      (error: unknown) => this.#reply(id, { rpc: this.#asRpcError(error, method) }),
    );
  }

  #handleNotification(method: string, params: unknown): void {
    try {
      this.#options.onNotification?.(method, params);
    } catch (error) {
      this.#options.onInternalError?.(error, method);
    }
  }

  #asRpcError(error: unknown, method: string): RpcError {
    if (error instanceof RpcError) return error;
    this.#options.onInternalError?.(error, method);
    return new RpcError(
      this.#diagnostic("MOSTRA_HOST_INTERNAL_ERROR", `${method} failed unexpectedly.`),
    );
  }

  #settle(id: JsonRpcId, action: (pending: Pending) => void): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    if (pending.timer !== undefined) clearTimeout(pending.timer);
    action(pending);
  }

  #reply(id: JsonRpcId | null, outcome: { result: unknown } | { rpc: RpcError }): void {
    if (this.#closed) return;
    if ("rpc" in outcome) {
      this.#send({ jsonrpc: "2.0", id, error: outcome.rpc.toErrorObject() });
    } else if (id !== null) {
      this.#send({ jsonrpc: "2.0", id, result: outcome.result });
    }
  }

  #send(message: JsonRpcMessage): void {
    try {
      this.#options.send(message);
    } catch {
      this.close();
    }
  }

  #diagnostic(
    code:
      | "MOSTRA_HOST_MALFORMED"
      | "MOSTRA_HOST_METHOD_UNKNOWN"
      | "MOSTRA_HOST_INTERNAL_ERROR"
      | "MOSTRA_HOST_TIMEOUT"
      | "MOSTRA_HOST_CONNECTION_CLOSED",
    message: string,
  ): Diagnostic {
    return hostDiagnostic(code, { message }, this.#options.docsBase);
  }
}

function describeIssue(
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
): string {
  const [first] = issues;
  if (!first) return "unknown problem";
  const path = first.path.map(String).join(".");
  return `${path === "" ? "(root)" : path}: ${first.message}`;
}

/**
 * Validates a method's params against its schema and returns the parsed value. Throws an
 * {@link RpcError} with `MOSTRA_HOST_INVALID_PARAMS` naming the first problem; the message
 * describes types and paths, never the values sent.
 */
export function parseParams<P, R>(
  definition: MethodDefinition<P, R>,
  params: unknown,
  docsBase?: string,
): P {
  const parsed = definition.params.safeParse(params ?? {});
  if (parsed.success) return parsed.data;
  throw new RpcError(
    hostDiagnostic(
      "MOSTRA_HOST_INVALID_PARAMS",
      { message: `Invalid params for ${definition.method}: ${describeIssue(parsed.error.issues)}` },
      docsBase,
    ),
  );
}
