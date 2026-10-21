/**
 * The kit's side of the harness protocol: starts a host's shim (a command line), speaks to it
 * over its stdio, and gives scenarios typed methods. The shim's stderr is kept (its last lines
 * explain a failure). A shim that exits ends every pending call with
 * `MOSTRA_HOST_CONNECTION_CLOSED`.
 */
import { type ChildProcess, spawn } from "node:child_process";
import {
  createDiagnostic,
  type Diagnostic,
  encodeLine,
  LineSplitter,
  RpcError,
  RpcPeer,
} from "@mostra/protocol";
import { kitVersion } from "../version.ts";
import {
  type CallError,
  type CallResult,
  CallResult as CallResultSchema,
  type EventsParams,
  type EventsResult,
  EventsResult as EventsResultSchema,
  HARNESS_METHODS,
  HARNESS_REVISIONS,
  type InitializeResult,
  InitializeResult as InitializeResultSchema,
  type ScriptParams,
  type StartParams,
  type StartResult,
  StartResult as StartResultSchema,
  type StoreResult,
  StoreResult as StoreResultSchema,
} from "./protocol.ts";

/** How long one harness request may take before the kit gives up on the host. */
const HARNESS_TIMEOUT_MS = 120_000;

/** An instance's error, carried through the host: its diagnostic code and JSON-RPC code. */
export class InstanceError extends Error {
  /** The diagnostic code (`MOSTRA_…`). */
  readonly code: string;
  /** The JSON-RPC error code. */
  readonly rpcCode: number;
  /** The diagnostic as it arrived. */
  readonly data: CallError["data"];

  constructor(method: string, error: CallError) {
    super(`${method} failed with ${error.data.code}: ${error.data.message ?? ""}`);
    this.name = "InstanceError";
    this.code = error.data.code;
    this.rpcCode = error.code;
    this.data = error.data;
  }
}

/** A host under test, reached through its harness shim. */
export class HostUnderTest {
  readonly #child: ChildProcess;
  readonly #peer: RpcPeer;
  readonly #stderr: string[] = [];
  readonly #exited: Promise<number | null>;
  /** What the host said about itself. */
  info: InitializeResult | undefined;

  private constructor(command: string, env: Readonly<Record<string, string>>) {
    this.#child = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env } as NodeJS.ProcessEnv,
      detached: true,
    });
    this.#exited = new Promise((done) => {
      this.#child.on("close", (code) => done(code));
      this.#child.on("error", () => done(null));
    });
    this.#peer = new RpcPeer({
      send: (message) => {
        if (this.#child.stdin?.writable) this.#child.stdin.write(encodeLine(message));
      },
    });
    const lines = new LineSplitter();
    this.#child.stdout?.setEncoding("utf8");
    this.#child.stdout?.on("data", (chunk: string) => {
      for (const line of lines.push(chunk)) this.#peer.receiveLine(line);
    });
    const errors = new LineSplitter();
    this.#child.stderr?.setEncoding("utf8");
    this.#child.stderr?.on("data", (chunk: string) => {
      for (const line of errors.push(chunk)) {
        this.#stderr.push(line);
        if (this.#stderr.length > 40) this.#stderr.shift();
      }
    });
    this.#child.stdin?.on("error", () => {});
    void this.#exited.then((code) =>
      this.#peer.close(
        createDiagnostic("MOSTRA_HOST_CONNECTION_CLOSED", {
          message: `The host under test exited (${code ?? "signal"}): ${this.#stderr.slice(-3).join(" | ")}`,
        }),
      ),
    );
  }

  /** Starts the shim and asks it who it is. */
  static async start(
    command: string,
    env: Readonly<Record<string, string>> = {},
  ): Promise<HostUnderTest> {
    const host = new HostUnderTest(command, env);
    try {
      const answer = await host.#request(HARNESS_METHODS.initialize, {
        revision: HARNESS_REVISIONS.at(-1),
        kit: { name: "@mostra/conformance", version: kitVersion() },
      });
      host.info = InitializeResultSchema.parse(answer);
    } catch (error) {
      await host.close();
      throw error;
    }
    return host;
  }

  /** The host's last stderr lines. */
  get stderr(): readonly string[] {
    return this.#stderr;
  }

  /** Whether the host serves `port` / supports `feature`. */
  serves(port: string): boolean {
    return this.info?.ports.includes(port) ?? false;
  }
  /** Whether the host supports the harness feature `feature`. */
  supports(feature: string): boolean {
    return this.info?.features.includes(feature) ?? false;
  }

  #request(method: string, params: unknown, timeoutMs = HARNESS_TIMEOUT_MS): Promise<unknown> {
    return this.#peer.request(method, params as never, { timeoutMs });
  }

  /** `harness/start`: the host starts or attaches to its instance. */
  async startInstance(params: StartParams): Promise<StartResult> {
    return StartResultSchema.parse(await this.#request(HARNESS_METHODS.start, params));
  }

  /** `harness/call`, raw: the instance's answer or error as the host received it. */
  async callRaw(method: string, params: unknown, timeoutMs?: number): Promise<CallResult> {
    return CallResultSchema.parse(
      await this.#request(
        HARNESS_METHODS.call,
        { method, params, ...(timeoutMs !== undefined ? { timeoutMs } : {}) },
        (timeoutMs ?? 60_000) + 30_000,
      ),
    );
  }

  /** `harness/call`: the answer, or an {@link InstanceError}. */
  async call<T = Record<string, unknown>>(
    method: string,
    params: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    const answer = await this.callRaw(method, params, timeoutMs);
    if ("error" in answer) throw new InstanceError(method, answer.error);
    return answer.result as T;
  }

  /** `harness/stop`: the host ends its session. */
  async stopInstance(): Promise<void> {
    await this.#request(HARNESS_METHODS.stop, {});
  }

  /** `harness/store`. */
  async store(): Promise<StoreResult> {
    return StoreResultSchema.parse(await this.#request(HARNESS_METHODS.store, {}));
  }

  /** `harness/script` (feature `faults`). */
  async script(params: ScriptParams): Promise<void> {
    await this.#request(HARNESS_METHODS.script, params);
  }

  /** `harness/events` (feature `events`). */
  async events(params: EventsParams): Promise<EventsResult> {
    return EventsResultSchema.parse(
      await this.#request(HARNESS_METHODS.events, params, params.timeoutMs + 30_000),
    );
  }

  /** Ends the shim: stdin closes, then SIGTERM to its process group, then SIGKILL. */
  async close(): Promise<void> {
    this.#child.stdin?.end();
    const pid = this.#child.pid;
    const signal = (name: NodeJS.Signals): void => {
      if (pid === undefined) return;
      try {
        process.kill(-pid, name);
      } catch {
        // gone already
      }
    };
    const outcome = await Promise.race([
      this.#exited.then(() => "exited" as const),
      new Promise<"waiting">((done) => setTimeout(() => done("waiting"), 5000)),
    ]);
    if (outcome === "waiting") {
      signal("SIGTERM");
      const later = await Promise.race([
        this.#exited.then(() => "exited" as const),
        new Promise<"waiting">((done) => setTimeout(() => done("waiting"), 5000)),
      ]);
      if (later === "waiting") signal("SIGKILL");
    }
    this.#peer.close();
  }
}

/** A diagnostic code from an error the kit saw: the instance's, an RPC error's, or none. */
export function codeOf(error: unknown): string | undefined {
  if (error instanceof InstanceError) return error.code;
  if (error instanceof RpcError) return (error.diagnostic as Diagnostic).code;
  return undefined;
}
