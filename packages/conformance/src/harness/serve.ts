/**
 * The host's side of the harness protocol, for hosts written in TypeScript: `serveHarness` reads
 * the kit's requests on stdin and answers them with the host's implementation, on stdout. A host
 * writes its shim as one small program around its real integration:
 *
 * ```ts
 * serveHarness({
 *   initialize: () => ({ host: { name: "my-host", version: "1.0.0" }, ports: ["submissions"], features: [] }),
 *   start: (params) => myHost.startMostra(params.home, params.env),
 *   call: (method, params) => myHost.mostra.call(method, params),
 *   stop: () => myHost.stopMostra(),
 *   store: () => myHost.conformanceStore(),
 * });
 * ```
 *
 * Nothing but protocol messages may go to stdout; log to stderr.
 */
import { createDiagnostic, encodeLine, LineSplitter, RpcError, RpcPeer } from "@mostra/protocol";
import {
  CallParams,
  type CallResult,
  EventsParams,
  type EventsResult,
  HARNESS_METHODS,
  HARNESS_REVISIONS,
  type InitializeResult,
  ScriptParams,
  StartParams,
  type StartResult,
  type StoreResult,
} from "./protocol.ts";

/** What a TypeScript host implements to be driven by the kit. */
export interface HarnessImplementation {
  /** Who the host is, the ports it serves and its features. */
  initialize(): Omit<InitializeResult, "revision"> | Promise<Omit<InitializeResult, "revision">>;
  /** Starts (or attaches to) the host's instance for `params.home`, with its real ports. */
  start(params: StartParams): StartResult | Promise<StartResult>;
  /** Sends one host-protocol request through the host's client; throw an `RpcError` for an error answer. */
  call(method: string, params: unknown, timeoutMs?: number): unknown;
  /** Ends the host's session. */
  stop(): void | Promise<void>;
  /** What the host's own store holds. */
  store(): StoreResult | Promise<StoreResult>;
  /** Feature `faults`: answer a port as the kit asks. */
  script?(params: ScriptParams): void | Promise<void>;
  /** Feature `events`: read pages from the host's own named event stream. */
  events?(params: EventsParams): EventsResult | Promise<EventsResult>;
}

function invalid(method: string, message: string): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_HOST_INVALID_PARAMS", { message: `${method}: ${message}` }),
    -32602,
  );
}

/**
 * Serves the harness protocol on this process's stdin and stdout until stdin ends, then stops
 * the host's session and resolves.
 */
export function serveHarness(
  implementation: HarnessImplementation,
  io: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream } = {},
): Promise<void> {
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stdout;
  const peer = new RpcPeer({
    send: (message) => {
      output.write(encodeLine(message));
    },
    onRequest: async (method, params) => {
      switch (method) {
        case HARNESS_METHODS.initialize: {
          const revision = HARNESS_REVISIONS.at(-1) as string;
          return { revision, ...(await implementation.initialize()) };
        }
        case HARNESS_METHODS.start: {
          const parsed = StartParams.safeParse(params);
          if (!parsed.success) throw invalid(method, parsed.error.message);
          return await implementation.start(parsed.data);
        }
        case HARNESS_METHODS.call: {
          const parsed = CallParams.safeParse(params);
          if (!parsed.success) throw invalid(method, parsed.error.message);
          try {
            const result = await implementation.call(
              parsed.data.method,
              parsed.data.params,
              parsed.data.timeoutMs,
            );
            return { result: result ?? null } satisfies CallResult;
          } catch (error) {
            if (error instanceof RpcError)
              return {
                error: { code: error.code, data: { ...error.diagnostic } },
              } satisfies CallResult;
            throw error;
          }
        }
        case HARNESS_METHODS.stop:
          await implementation.stop();
          return {};
        case HARNESS_METHODS.store:
          return await implementation.store();
        case HARNESS_METHODS.script: {
          if (!implementation.script) break;
          const parsed = ScriptParams.safeParse(params);
          if (!parsed.success) throw invalid(method, parsed.error.message);
          await implementation.script(parsed.data);
          return {};
        }
        case HARNESS_METHODS.events: {
          if (!implementation.events) break;
          const parsed = EventsParams.safeParse(params);
          if (!parsed.success) throw invalid(method, parsed.error.message);
          return await implementation.events(parsed.data);
        }
      }
      throw new RpcError(
        createDiagnostic("MOSTRA_HOST_METHOD_UNKNOWN", {
          message: `This host serves no harness method ${method}.`,
        }),
        -32601,
      );
    },
    onInternalError: (error, method) => {
      process.stderr.write(`harness: ${method} failed: ${(error as Error).stack ?? error}\n`);
    },
  });
  const lines = new LineSplitter();
  (input as NodeJS.ReadStream).setEncoding?.("utf8");
  input.on("data", (chunk: string) => {
    for (const line of lines.push(chunk)) peer.receiveLine(line);
  });
  return new Promise((done) => {
    input.on("end", () => {
      void Promise.resolve(implementation.stop())
        .catch(() => undefined)
        .finally(() => {
          peer.close();
          done();
        });
    });
  });
}
