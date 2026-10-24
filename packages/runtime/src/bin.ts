#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
/**
 * `mostra-runtime`, the runtime bundle's entry point (D85).
 *
 *   mostra-runtime host [--home <dir>]     the host protocol over stdio (`mostra host`)
 *   mostra-runtime daemon [--home <dir>] [--always-on]
 *                                          the home's daemon on its socket (`mostra daemon start`);
 *                                          it exits after 30 idle minutes unless `--always-on`
 *   mostra-runtime service install|uninstall|status [--home <dir>] [--no-start]
 *                                          the home's login service (`mostra daemon install`, D62):
 *                                          one JSON line with the service's file and state
 *
 * Both take `--bind <address>` to serve viewers on an address other than 127.0.0.1, and
 * `--url-host <name>`, the host name links use, which a wildcard address needs (D99). Neither is
 * remembered: every wider start is explicit.
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
import { checkPlatform, resolveHomePath } from "./home/index.ts";
import { type Instance, runtimeVersion, startInstance } from "./instance/index.ts";
import { realPath } from "./platform/index.ts";
import { installService, serviceStatus, uninstallService } from "./service/index.ts";

/** Exit codes, as INTERFACES §9 defines them for the CLI. */
const EXIT = { ok: 0, failure: 1, usage: 2, environment: 3 } as const;

const USAGE = [
  "usage: mostra-runtime <host|daemon> [--home <dir>] [--bind <address> [--url-host <name>]] [--always-on]",
  "       mostra-runtime service <install|uninstall|status> [--home <dir>] [--no-start]",
].join("\n");

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
  // SIGTERM and SIGINT on POSIX; on Windows Ctrl+C and Ctrl+Break reach a console process as
  // SIGINT and SIGBREAK, and everything else stops it over the protocol (`mostra/shutdown`, D87).
  for (const signal of ["SIGTERM", "SIGINT", "SIGBREAK"] as const) {
    process.on(signal, () => void instance.stop(signal, EXIT.ok));
  }
  process.on("SIGPIPE", () => {});
  // Last resort: children never outlive an exiting supervisor (FAILURE_MODEL §2).
  process.on("exit", () => instance.processes.killAll());
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
  if (mode === "service" && !values.help)
    return await service(rest, values.home, values["no-start"] === true);
  if (values.help || (mode !== "host" && mode !== "daemon") || rest.length > 0) {
    (values.help ? process.stdout : process.stderr).write(`${USAGE}\n`);
    return values.help ? EXIT.ok : EXIT.usage;
  }

  try {
    const started = await startInstance({
      mode,
      home: values.home,
      bind: values.bind,
      urlHost: values["url-host"],
      alwaysOn: values["always-on"] === true,
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

/** `mostra-runtime service …`: the home's login service, as one JSON line (D62, RT-08). */
async function service(
  args: readonly string[],
  home: string | undefined,
  noStart: boolean,
): Promise<number> {
  const [action, ...extra] = args;
  if ((action !== "install" && action !== "uninstall" && action !== "status") || extra.length > 0) {
    process.stderr.write(`${USAGE}\n`);
    return EXIT.usage;
  }
  const gate = checkPlatform();
  if (gate) {
    process.stdout.write(`${JSON.stringify({ status: "failed", diagnostic: gate })}\n`);
    return EXIT.environment;
  }
  try {
    const resolved = resolveHomePath({ home, env: process.env });
    mkdirSync(resolved, { recursive: true, mode: 0o700 });
    const spec = {
      // As the daemon spells its home, so the service's name and hash are the daemon's (D82).
      home: realPath(resolved),
      node: process.execPath,
      entry: fileURLToPath(import.meta.url),
    };
    // Who asks, should a Windows uninstall stop the daemon over its pipe.
    const client = { name: "mostra-runtime-service", version: runtimeVersion() };
    const status =
      action === "install"
        ? await installService(spec, { noStart, client })
        : action === "uninstall"
          ? await uninstallService(spec, { noStart, client })
          : serviceStatus(spec);
    process.stdout.write(`${JSON.stringify({ status: "ok", action, service: status })}\n`);
    return EXIT.ok;
  } catch (error) {
    const diagnostic = diagnosticOf(error);
    process.stdout.write(`${JSON.stringify({ status: "failed", diagnostic })}\n`);
    return EXIT.environment;
  }
}

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      home: { type: "string" },
      bind: { type: "string" },
      "url-host": { type: "string" },
      "always-on": { type: "boolean" },
      "no-start": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
  });
}

const code = await main(process.argv.slice(2));
// Let stdout drain before exiting, so the status line is never cut off.
process.stdout.write("", () => process.exit(code));
