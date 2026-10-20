/**
 * The npm bootstrap (RT-01, D142): a `mostra` installed from npm runs on whatever Node.js the
 * system has, so before anything else it finds the runtime bundle its release pins (from the
 * cache, or downloaded once, with progress on stderr) and runs the bundle's own `mostra` with the
 * same arguments on the bundle's private Node.js. Every command, telemetry included, then runs in
 * the bundle, and this process only waits and passes the exit code on.
 *
 * Inside a bundle, in a development checkout, or with `MOSTRA_BUNDLE`/`MOSTRA_RUNTIME_BIN` set,
 * there is nothing to bootstrap and the CLI runs in this process.
 *
 * This module runs on the system's Node.js, so it uses nothing newer than Node.js 22.19 and loads
 * none of the CLI's commands.
 */
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { createDiagnostic, type Diagnostic, RpcError } from "@mostra/protocol";
import { enclosingBundle, type InstallProgress, readPins, resolveRuntime } from "@mostra/sdk";
import { exitCodeFor } from "./exit.ts";
import type { Environment } from "./home.ts";

/** How the bootstrap talks to the terminal. */
export interface BootstrapIo {
  readonly argv: readonly string[];
  readonly env: Environment;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Whether stderr is a terminal: progress then rewrites one line. */
  readonly stderrTty: boolean;
  /**
   * Whether a terminal is attached (stdin, stdout or stderr is one). Ctrl-C there signals the
   * whole foreground process group, the bundle's `mostra` included, so SIGINT isn't forwarded:
   * a second one would cut short a command that stops gracefully on the first (`mostra dev`).
   */
  readonly terminal: boolean;
}

/** Whether this CLI should move into its pinned bundle before running a command. */
export function needsBootstrap(env: Environment): boolean {
  if (env["MOSTRA_BUNDLE"] || env["MOSTRA_RUNTIME_BIN"]) return false;
  if (enclosingBundle() !== undefined) return false;
  return readPins(env) !== undefined;
}

/** Progress lines for a person waiting on the first download. */
function progressReporter(io: BootstrapIo): (progress: InstallProgress) => void {
  let lastPercent = -1;
  let lastStep = "";
  return (progress) => {
    if (progress.step === "download") {
      const percent = Math.floor((progress.received / progress.total) * 100);
      const mb = (bytes: number): string => `${Math.round(bytes / 1e6)} MB`;
      if (io.stderrTty) {
        if (percent !== lastPercent)
          io.stderr(
            `\rmostra: downloading the Mostra runtime, ${mb(progress.received)} of ${mb(progress.total)} (${percent}%)`,
          );
      } else if (
        lastStep !== "download" ||
        Math.floor(percent / 25) > Math.floor(lastPercent / 25)
      ) {
        io.stderr(`mostra: downloading the Mostra runtime (${mb(progress.total)}): ${percent}%\n`);
      }
      lastPercent = percent;
      lastStep = "download";
      return;
    }
    if (progress.step === lastStep) return;
    if (lastStep === "download" && io.stderrTty) io.stderr("\n");
    lastStep = progress.step;
    const words: Partial<Record<InstallProgress["step"], string>> = {
      files: "checking the runtime's files",
      browser: "fetching the browser verify uses",
    };
    const said = words[progress.step];
    if (said !== undefined) io.stderr(`mostra: ${said}…\n`);
  };
}

/** The envelope `--json` promises, for a bootstrap that fails before any command runs. */
function failed(io: BootstrapIo, diagnostic: Diagnostic): number {
  io.stderr(`mostra: ${diagnostic.message}\n`);
  if (diagnostic.hint) io.stderr(`mostra: ${diagnostic.hint}\n`);
  if (io.argv.includes("--json")) {
    io.stdout(`${JSON.stringify({ ok: false, error: diagnostic, warnings: [] })}\n`);
  }
  return exitCodeFor(diagnostic.code);
}

/**
 * When this copy needs the bundle its release pins (`needsBootstrap`), runs the bundle's
 * `mostra` with `io.argv` and resolves with its exit code; otherwise resolves `undefined`, and the
 * caller runs the command itself. Any failure, deciding included, is a diagnostic (one envelope
 * with `--json`) and its exit code. Signals this process gets are passed on to the child.
 */
export async function bootstrap(io: BootstrapIo): Promise<number | undefined> {
  try {
    // Deciding is inside the boundary too: pins that can't be read are a diagnostic, never a
    // stack trace (GPT review finding 3).
    if (!needsBootstrap(io.env)) return undefined;
    return await runInBundle(io);
  } catch (error) {
    // Whatever goes wrong, `--json` still gets exactly one envelope (D140 item 16).
    if (error instanceof RpcError) return failed(io, error.diagnostic);
    return failed(
      io,
      createDiagnostic("MOSTRA_HOST_INTERNAL_ERROR", {
        message: `The npm bootstrap failed: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }
}

async function runInBundle(io: BootstrapIo): Promise<number> {
  const runtime = await resolveRuntime({ env: io.env, onProgress: progressReporter(io) });
  if (runtime.cliEntry === undefined) {
    throw new RpcError(
      createDiagnostic("MOSTRA_ENV_RUNTIME_MISSING", {
        message: "The runtime the bootstrap found has no CLI entry.",
      }),
    );
  }
  const cli = runtime.cliEntry;
  return new Promise((resolve) => {
    const child = spawn(runtime.node, [cli, ...io.argv], {
      stdio: "inherit",
      env: io.env as NodeJS.ProcessEnv,
    });
    const forward = (signal: NodeJS.Signals): void => {
      if (signal === "SIGINT" && io.terminal) return; // the child got the terminal's own
      child.kill(signal);
    };
    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
    for (const signal of signals) process.on(signal, forward);
    let settled = false;
    const settle = (code: number): void => {
      if (settled) return;
      settled = true;
      for (const signal of signals) process.off(signal, forward);
      resolve(code);
    };
    child.on("error", (error) =>
      settle(
        failed(
          io,
          createDiagnostic("MOSTRA_ENV_RUNTIME_MISSING", {
            message: `The runtime bundle's CLI couldn't be started (${runtime.node}): ${error.message}`,
          }),
        ),
      ),
    );
    // A child ended by a signal exits as a shell reports it: 128 plus the signal's number.
    child.on("exit", (code, signal) =>
      settle(code ?? 128 + (signal ? (constants.signals[signal] ?? 0) : 0)),
    );
  });
}
