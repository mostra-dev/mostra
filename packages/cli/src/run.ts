/**
 * The runner (INTERFACES §9, D140 item 16): reads the command line, runs one command, and owns
 * everything commands share. stdout carries exactly one JSON value in `--json` mode (one per line
 * for a stream), whatever happens, usage errors and crashes included; logs, progress and warnings
 * go to stderr; the exit code comes from one table; telemetry's notice or question comes before
 * the command's work and its events after it.
 */
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  createDiagnostic,
  type Diagnostic,
  type MethodDefinition,
  RpcError,
} from "@mostra/protocol";
import { connect, type InstanceConnection, type InstanceSummary } from "./client.ts";
import {
  type CommandContext,
  type CommandDef,
  type CommandOutcome,
  commandName,
} from "./command.ts";
import { COMMANDS } from "./commands/index.ts";
import { EXIT, exitCodeFor } from "./exit.ts";
import { commandDefinition, commandHelp, groupHelp, topHelp, UNBOUNDED } from "./help.ts";
import {
  configDir,
  type Environment,
  embeddedHome,
  locateRuntime,
  readHomeMarks,
  resolveHome,
} from "./home.ts";
import { globalFlags, parseCommandLine } from "./parse.ts";
import { telemetrySession } from "./telemetry/index.ts";
import { cliVersion } from "./version.ts";

/** What the runner reads and writes; the binary passes the process's, tests their own. */
export interface RunnerIo {
  /** The words after mostra. */
  readonly argv: readonly string[];
  /** The environment. */
  readonly env: Environment;
  /** The working directory. */
  readonly cwd: string;
  /** Writes to stdout. */
  readonly stdout: (text: string) => void;
  /** Writes to stderr. */
  readonly stderr: (text: string) => void;
  /** Standard input. */
  readonly stdin: NodeJS.ReadableStream;
  /** Which of the streams are terminals. */
  readonly tty: { readonly stdin: boolean; readonly stdout: boolean; readonly stderr: boolean };
  /** The platform; default process.platform. */
  readonly platform?: string;
}

/** The diagnostic an exception is, for the envelope: its own, or an internal error. */
function diagnosticOf(error: unknown): Diagnostic {
  if (error instanceof RpcError) return error.diagnostic;
  return createDiagnostic("MOSTRA_HOST_INTERNAL_ERROR", {
    message: `mostra failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
  });
}

/** A diagnostic for people, on stderr. */
function describe(diagnostic: Diagnostic): string {
  const hint = diagnostic.hint ? `\n  ${diagnostic.hint}` : "";
  const fix =
    diagnostic.fix?.kind === "command" && diagnostic.fix.command
      ? `\n  Run: ${diagnostic.fix.command}`
      : "";
  return `${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}${hint}${fix}\n  ${diagnostic.docs}\n`;
}

/** Reads the whole of stdin. */
function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

/** Asks one question on stderr, read from stdin: the answer, `undefined` after the timeout, or Ctrl-C. */
function ask(
  io: RunnerIo,
  question: string,
  timeoutMs: number,
): Promise<string | undefined | "interrupt"> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: io.stdin, output: process.stderr, terminal: true });
    let done = false;
    const finish = (answer: string | undefined | "interrupt"): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      rl.close();
      resolve(answer);
    };
    const timer = setTimeout(() => {
      io.stderr("\n");
      finish(undefined);
    }, timeoutMs);
    rl.on("SIGINT", () => {
      io.stderr("\n");
      finish("interrupt");
    });
    rl.on("close", () => finish(""));
    rl.question(question, (answer) => finish(answer));
  });
}

/** Runs one command line and returns its exit code. */
export async function run(io: RunnerIo): Promise<number> {
  const started = Date.now();
  const global = globalFlags(io.argv);
  const json = global.json;
  const warnings: Diagnostic[] = [];
  let summary: InstanceSummary | undefined;
  let connection: InstanceConnection | undefined;
  let streamed = false;

  const writeJson = (value: unknown): void => io.stdout(`${JSON.stringify(value)}\n`);
  const fail = (diagnostic: Diagnostic): number => {
    if (json) {
      writeJson({
        ok: false,
        error: diagnostic,
        ...(summary && !streamed ? { instance: summary } : {}),
        warnings,
      });
    } else io.stderr(describe(diagnostic));
    return exitCodeFor(diagnostic.code);
  };

  // Every entry point fails closed on an unsupported platform before touching the home (D35).
  const platform = io.platform ?? process.platform;
  if (platform !== "darwin" && platform !== "linux") {
    return fail(
      createDiagnostic("MOSTRA_PLATFORM_UNSUPPORTED", {
        message: `Mostra runs on macOS and Linux; this is ${platform}.`,
      }),
    );
  }

  let parsed: ReturnType<typeof parseCommandLine>;
  try {
    parsed = parseCommandLine(COMMANDS, io.argv);
  } catch (error) {
    return fail(diagnosticOf(error));
  }
  if (parsed.kind === "version") {
    if (json) writeJson({ ok: true, result: { version: cliVersion() }, warnings });
    else io.stdout(`${cliVersion()}\n`);
    return EXIT.ok;
  }
  if (parsed.kind === "help") {
    if (json) {
      const result = parsed.command
        ? commandDefinition(parsed.command)
        : {
            commands: COMMANDS.filter(
              (command) => !parsed.group || command.path[0] === parsed.group,
            ).map(commandDefinition),
          };
      writeJson({ ok: true, result, warnings });
    } else {
      io.stdout(
        parsed.command
          ? commandHelp(parsed.command)
          : parsed.group
            ? groupHelp(COMMANDS, parsed.group)
            : topHelp(COMMANDS),
      );
    }
    return EXIT.ok;
  }

  const { command } = parsed;
  if (global.timeoutMs !== undefined && UNBOUNDED.has(command.path[0] ?? "")) {
    return fail(
      createDiagnostic("MOSTRA_CLI_USAGE", {
        message: `mostra ${commandName(command)} runs until Ctrl-C or its connection ends, so --timeout doesn't apply to it.`,
      }),
    );
  }
  // `wait --timeout` is the wait's own length, which ends with still_waiting (exit 5), never exit 4.
  const timeoutMs = command.path[0] === "wait" ? undefined : global.timeoutMs;
  const cwd = global.cwd !== undefined ? resolve(io.cwd, global.cwd) : io.cwd;
  const home = resolveHome({ home: global.home, env: io.env, cwd, platform });
  const config = configDir(io.env, cwd);
  const marks = readHomeMarks(home);
  const readsStdin =
    typeof command.readsStdin === "function"
      ? command.readsStdin(parsed.flags)
      : command.readsStdin === true;
  const telemetry = telemetrySession({
    env: io.env,
    configDir: config,
    command: commandName(command),
    json,
    tty: io.tty,
    readsStdin,
    quiet: command.quiet === true,
    hostHome: embeddedHome(marks),
    stderr: io.stderr,
    ask: (question, timeoutMs) => ask(io, question, timeoutMs),
  });

  let connectionClosed = false;
  const getConnection = async (autostart = true): Promise<InstanceConnection | undefined> => {
    // A session the instance ended (`daemon stop` before `daemon restart`) is opened again.
    if (connection && !connectionClosed) return connection;
    connectionClosed = false;
    const opened = await connect({
      home,
      env: io.env,
      autostart,
      timeoutMs,
    });
    if (!opened) return undefined;
    connection = opened;
    void opened.closed.then(() => {
      if (connection === opened) connectionClosed = true;
    });
    summary = opened.summary;
    for (const warning of opened.warnings) {
      warnings.push(warning);
      io.stderr(describe(warning));
    }
    return opened;
  };

  const context: CommandContext = {
    args: parsed.args,
    flags: parsed.flags,
    cwd,
    json,
    timeoutMs,
    env: io.env,
    tty: io.tty,
    home,
    configDir: config,
    stdout: io.stdout,
    stderr: io.stderr,
    async call<P, R>(method: MethodDefinition<P, R>, params: P): Promise<R> {
      const session = await getConnection();
      if (!session)
        throw new RpcError(
          createDiagnostic("MOSTRA_HOST_CONNECTION_CLOSED", {
            message: "No instance runs for this home.",
          }),
        );
      const remaining =
        timeoutMs === undefined ? undefined : Math.max(1, timeoutMs - (Date.now() - started));
      return session.call(method, params, remaining);
    },
    connection: getConnection,
    readStdin: () => readAll(io.stdin),
    log: (line) => io.stderr(`${line}\n`),
    emit(event, human) {
      if (json) {
        writeJson({ ok: true, event, ...(summary && !streamed ? { instance: summary } : {}) });
        streamed = true;
      } else if (human !== undefined) io.stdout(human);
    },
    warn(diagnostic) {
      warnings.push(diagnostic);
      io.stderr(describe(diagnostic));
    },
    record: (event) => telemetry.record(event),
    runtime: (args, stdio = "pipe") => runRuntime(io, args, stdio),
  };

  let exit: number;
  let error: string | undefined;
  try {
    // Telemetry never stops a command: a failure in it is a run without telemetry.
    if (!(await telemetry.begin().catch(() => true))) return 130;
    const outcome: CommandOutcome = await withTimeout(command, context, timeoutMs);
    exit = outcome.exit ?? EXIT.ok;
    if (outcome.raw) return exit;
    if (json) {
      writeJson({
        ok: true,
        result: outcome.result ?? null,
        ...(summary && !streamed && command.local !== true ? { instance: summary } : {}),
        warnings,
      });
    } else io.stdout(outcome.human ?? `${JSON.stringify(outcome.result, null, 2)}\n`);
  } catch (caught) {
    const diagnostic = diagnosticOf(caught);
    error = diagnostic.code;
    exit = fail(diagnostic);
  } finally {
    connection?.close();
  }
  try {
    telemetry.end({
      exit,
      durationMs: Date.now() - started,
      hostInstance: summary?.mode === "host",
      ...(error !== undefined ? { error } : {}),
    });
  } catch {
    // Telemetry never changes a command's outcome.
  }
  return exit;
}

/**
 * Runs a command, bounded by `--timeout` (exit 4 with `MOSTRA_HOST_TIMEOUT`). `host` and `dev` run
 * until their connection or Ctrl-C ends them, so `--timeout` bounds neither.
 */
async function withTimeout(
  command: CommandDef,
  context: CommandContext,
  timeoutMs: number | undefined,
): Promise<CommandOutcome> {
  if (timeoutMs === undefined || command.path[0] === "host" || command.path[0] === "dev")
    return command.run(context);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      command.run(context),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new RpcError(
                createDiagnostic("MOSTRA_HOST_TIMEOUT", {
                  message: `mostra ${commandName(command)} didn't finish within --timeout (${timeoutMs} ms); what it asked for may still take effect.`,
                }),
              ),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs `mostra-runtime …` and collects its stdout. */
function runRuntime(
  io: RunnerIo,
  args: readonly string[],
  stdio: "pipe" | "inherit",
): Promise<{ code: number; stdout: string }> {
  const runtime = locateRuntime(io.env);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...runtime.nodeArgs, runtime.entry, ...args], {
      stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
      env: io.env as NodeJS.ProcessEnv,
    });
    let stdout = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => io.stderr(chunk));
    child.on("error", () => resolve({ code: EXIT.environment, stdout }));
    // `close`, not `exit`: the line may still be in the pipe when the process has exited.
    child.on("close", (code) => resolve({ code: code ?? EXIT.environment, stdout }));
  });
}
