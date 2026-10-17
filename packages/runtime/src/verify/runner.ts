/**
 * The supervisor's side of the verify runner (ARCHITECTURE §1, FAILURE_MODEL §2): one runner child
 * at a time, started through the process manager on the first render and kept while it lives (it
 * exits by itself after 10 idle minutes, closing its warm Chromium). A runner that dies during a
 * request fails it with `MOSTRA_VERIFY_CRASHED` and its last lines; the next request starts a
 * fresh one. The supervisor never loads Playwright (RT-02).
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  type CompareRequest,
  type CompareResult,
  createDiagnostic,
  type RenderRequest,
  type RenderResult,
  RpcError,
  VERIFY_RUNNER_METHODS,
} from "@mostra/protocol";
import type { Environment, Log } from "../log.ts";
import type { ChildHandle, ProcessManager } from "../processes/index.ts";

/** The runner child's entry and Node arguments: `MOSTRA_VERIFY_ENTRY`, else beside the runtime. */
export function locateRunner(
  env: Environment,
  runtimeRoot: string,
): { readonly entry: string; readonly nodeArgs: readonly string[] } {
  const override = env["MOSTRA_VERIFY_ENTRY"];
  if (override) return { entry: override, nodeArgs: [] };
  const fromSource = import.meta.url.endsWith(".ts");
  const built = resolve(runtimeRoot, "..", "verify", "dist", "main.js");
  if (!fromSource || existsSync(built)) return { entry: built, nodeArgs: [] };
  return {
    entry: resolve(runtimeRoot, "..", "verify", "src", "main.ts"),
    nodeArgs: ["--conditions=@mostra/source"],
  };
}

/** The runner as the verify pipeline uses it. */
export interface RunnerClient {
  render(request: RenderRequest): Promise<RenderResult>;
  compare(request: CompareRequest): Promise<CompareResult>;
  /** Stops the runner child, if one runs. */
  close(): Promise<void>;
}

/** The variables the runner child gets: where Playwright's browsers are, and nothing secret. */
function runnerEnvironment(env: Environment): Environment {
  const keep = [
    "PATH",
    "HOME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TZ",
    "PLAYWRIGHT_BROWSERS_PATH",
    "XDG_CACHE_HOME",
  ];
  const out: Record<string, string> = {};
  for (const name of keep) {
    const value = env[name];
    if (value !== undefined) out[name] = value;
  }
  const idle = env["MOSTRA_TEST_VERIFY_IDLE_MS"];
  if (idle) out["MOSTRA_TEST_VERIFY_IDLE_MS"] = idle;
  return out;
}

/** Creates the client; nothing starts until the first request. */
export function createRunnerClient(options: {
  readonly processes: ProcessManager;
  readonly log: Log;
  readonly env: Environment;
  readonly entry: string;
  readonly nodeArgs: readonly string[];
}): RunnerClient {
  let child: Promise<ChildHandle> | undefined;

  const start = (): Promise<ChildHandle> => {
    child ??= options.processes
      .spawn({
        kind: "verify",
        ownerRef: "verify-runner",
        command: process.execPath,
        args: [...options.nodeArgs, options.entry],
        env: runnerEnvironment(options.env),
        ipc: {},
      })
      .then((handle) => {
        void handle.exited.then((exit) => {
          options.log.info("verify.runner_exited", { code: exit.code, signal: exit.signal });
          if (child) {
            void child.then((current) => {
              if (current === handle) child = undefined;
            });
          }
        });
        return handle;
      })
      .catch((error: unknown) => {
        child = undefined;
        throw error;
      });
    return child;
  };

  const ask = async (method: string, params: object): Promise<unknown> => {
    const handle = await start();
    const outcome = await Promise.race([
      handle.request(method, params as Record<string, unknown>).then(
        (result) => ({ kind: "result" as const, result }),
        (error: unknown) => ({ kind: "error" as const, error }),
      ),
      handle.exited.then((exit) => ({ kind: "exit" as const, exit })),
    ]);
    if (outcome.kind === "result") return outcome.result;
    if (outcome.kind === "error" && outcome.error instanceof RpcError) {
      // The runner answered with a diagnostic (no browser, say), or its channel closed.
      if (outcome.error.diagnostic.code !== "MOSTRA_HOST_INTERNAL_ERROR") throw outcome.error;
    }
    const exit =
      outcome.kind === "exit"
        ? outcome.exit
        : await Promise.race([
            handle.exited,
            new Promise<undefined>((done) => setTimeout(() => done(undefined), 1000)),
          ]);
    const tail = exit?.stderrTail.slice(-10).join("\n") ?? "";
    throw new RpcError(
      createDiagnostic("MOSTRA_VERIFY_CRASHED", {
        message: `The verify runner stopped before it answered${exit ? ` (${exit.signal ?? `code ${exit.code}`})` : ""}.${tail ? `\n${tail}` : ""}`,
      }),
    );
  };

  return {
    render: (request) => ask(VERIFY_RUNNER_METHODS.render, request) as Promise<RenderResult>,
    compare: (request) => ask(VERIFY_RUNNER_METHODS.compare, request) as Promise<CompareResult>,
    async close() {
      const running = child;
      child = undefined;
      if (running) await (await running.catch(() => undefined))?.stop(2000);
    },
  };
}
