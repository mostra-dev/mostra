#!/usr/bin/env node
/**
 * `mostra-runtime`, the runtime bundle's entry point (D85).
 *
 *   mostra-runtime host [--home <dir>]     the host protocol over stdio (`mostra host`)
 *   mostra-runtime daemon [--home <dir>]   the home's daemon on its socket (`mostra daemon start`)
 *
 * `daemon` prints one JSON line on stdout: `{"status":"started",…}` when it took the home,
 * `{"status":"attached",…}` when another daemon already owns it (then it exits 0), or
 * `{"status":"failed","diagnostic":…}` (exit 3). `host` speaks only the protocol on stdout; when it
 * can't start, it answers the host's first request with the diagnostic and exits 3. Logs go to
 * `<home>/logs/supervisor.log`; warnings and errors are mirrored to stderr.
 */
import { parseArgs } from "node:util";
import {
  createDiagnostic,
  type Diagnostic,
  encodeLine,
  LineSplitter,
  RpcError,
  RpcPeer,
} from "@mostra/protocol";
import { type Instance, runtimeVersion, startInstance } from "./instance/index.ts";

/** Exit codes, as INTERFACES §9 defines them for the CLI. */
const EXIT = { ok: 0, failure: 1, usage: 2, environment: 3 } as const;

const USAGE = "usage: mostra-runtime <host|daemon> [--home <dir>]";

// A closed stdout or stderr (a starter that read the ready line and left) must not crash the
// supervisor.
process.stdout.on("error", () => {});
process.stderr.on("error", () => {});

const mirror = (line: string): void => {
  process.stderr.write(line);
};

function diagnosticOf(error: unknown): Diagnostic {
  if (error instanceof RpcError) return error.diagnostic;
  return createDiagnostic("MOSTRA_HOST_INTERNAL_ERROR", {
    message: `mostra-runtime failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
  });
}

/**
 * In host mode, a supervisor that can't start still speaks the protocol: it answers the host's
 * requests with the diagnostic, then exits once the first is answered or stdin ends.
 */
function refuseOverStdio(diagnostic: Diagnostic, exitCode: number): void {
  mirror(`${JSON.stringify({ level: "error", diagnostic })}\n`);
  const splitter = new LineSplitter();
  const exit = (): void => {
    process.stdout.write("", () => process.exit(exitCode));
  };
  const peer = new RpcPeer({
    send: (message) => {
      process.stdout.write(encodeLine(message));
    },
    onRequest: () => {
      setImmediate(exit);
      throw new RpcError(diagnostic);
    },
  });
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    try {
      for (const line of splitter.push(chunk)) peer.receiveLine(line);
    } catch {
      exit();
    }
  });
  process.stdin.on("end", exit);
  process.stdin.on("error", exit);
  setTimeout(exit, 30_000).unref();
}

function handleSignals(instance: Instance): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => void instance.stop(signal, EXIT.ok));
  }
  process.on("SIGPIPE", () => {});
  // Last resort: children never outlive an exiting supervisor (FAILURE_MODEL §2).
  process.on("exit", () => {
    for (const child of instance.processes.list()) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  });
  process.on("uncaughtException", (error) => {
    mirror(`${JSON.stringify({ level: "error", event: "uncaught", message: error.message })}\n`);
    void instance.stop("uncaught exception", EXIT.failure);
    setTimeout(() => process.exit(EXIT.failure), 15_000).unref();
  });
}

async function main(argv: readonly string[]): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n${USAGE}\n`);
    return EXIT.usage;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    process.stdout.write(`${runtimeVersion()}\n`);
    return EXIT.ok;
  }
  const [mode, ...rest] = positionals;
  if (values.help || (mode !== "host" && mode !== "daemon") || rest.length > 0) {
    (values.help ? process.stdout : process.stderr).write(`${USAGE}\n`);
    return values.help ? EXIT.ok : EXIT.usage;
  }

  try {
    const started = await startInstance({
      mode,
      home: values.home,
      mirror,
      ...(mode === "host" ? { stdio: { input: process.stdin, output: process.stdout } } : {}),
    });
    if (started.kind === "attached") {
      process.stdout.write(
        `${JSON.stringify({
          status: "attached",
          pid: started.record.pid,
          home: started.result.instance.home,
          socket: started.record.socket,
          revision: started.result.revision,
        })}\n`,
      );
      return EXIT.ok;
    }
    const { instance } = started;
    handleSignals(instance);
    if (mode === "daemon") {
      process.stdout.write(
        `${JSON.stringify({
          status: "started",
          pid: instance.info.pid,
          home: instance.info.home,
          socket: instance.socketPath,
          reaped: instance.reaped.filter((child) => child.signalled.length > 0).length,
        })}\n`,
      );
    }
    const stop = await instance.stopped;
    return stop.exitCode;
  } catch (error) {
    const diagnostic = diagnosticOf(error);
    const exitCode = error instanceof RpcError ? EXIT.environment : EXIT.failure;
    if (mode === "host") {
      refuseOverStdio(diagnostic, exitCode);
      return new Promise<number>(() => {});
    }
    process.stdout.write(`${JSON.stringify({ status: "failed", diagnostic })}\n`);
    mirror(`${JSON.stringify({ level: "error", diagnostic })}\n`);
    return exitCode;
  }
}

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      home: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
  });
}

const code = await main(process.argv.slice(2));
// Let stdout drain before exiting, so the status line is never cut off.
process.stdout.write("", () => process.exit(code));
