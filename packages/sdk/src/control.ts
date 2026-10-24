/**
 * Opening a home's control endpoint as a client (D45, D81, D150): the socket or pipe that
 * `instance.json` names, where a home's daemon serves the host protocol.
 *
 * - **POSIX:** a Unix socket in the owner-only runtime directory, opened with `node:net`.
 * - **Windows:** an owner-only named pipe, opened through the runtime's helper, `mostra-win
 *   connect`. A pipe's old name in `instance.json` may be free for another user to take, and
 *   Node.js can neither check who created a pipe nor stop its server acting as the client, so the
 *   helper connects without letting the server impersonate the client, refuses a pipe whose owner
 *   isn't this user, and relays the bytes over its standard streams (Opus review of WP-W1).
 *
 * The helper is the one beside the runtime the caller resolved: `MOSTRA_WIN_HELPER`, else the
 * runtime bundle's `bin/mostra-win.exe`, else a development checkout's Cargo build.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { dirname, join, resolve } from "node:path";
import { Duplex } from "node:stream";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import type { Environment } from "./bundle/setup.ts";
import type { Runtime } from "./runtime.ts";

/** Options of {@link connectControl}. */
export interface ControlOptions {
  /** The runtime whose helper opens a Windows pipe; required on Windows. */
  readonly runtime?: Runtime | undefined;
  /** The environment: `MOSTRA_WIN_HELPER`. */
  readonly env?: Environment | undefined;
  /** How long to wait for the endpoint to answer. Default 5000. */
  readonly timeoutMs?: number | undefined;
  /** The operating system, `process.platform` by default. */
  readonly platform?: string | undefined;
}

const PIPE_PREFIX = "\\\\.\\pipe\\";

/** The helper's exit code for a pipe another user owns (`crates/mostra-win/src/win/connect.rs`). */
const NOT_OWNED_EXIT = 3;

function unreachable(endpoint: string, why: string): RpcError {
  return new RpcError(
    createDiagnostic("MOSTRA_HOST_CONNECTION_CLOSED", {
      message: `Couldn't reach the instance at ${endpoint} (${why}).`,
    }),
  );
}

/**
 * The Windows helper beside `runtime`: `MOSTRA_WIN_HELPER`, else the bundle's
 * `bin/mostra-win.exe`, else, for a checkout's `packages/runtime/dist/bin.js`, Cargo's
 * `target/release` then `target/debug`. Throws `MOSTRA_ENV_HELPER_MISSING` when none exists.
 */
export function windowsHelper(runtime: Runtime | undefined, env: Environment): string {
  const override = env["MOSTRA_WIN_HELPER"];
  if (override) {
    if (existsSync(override)) return override;
    throw missingHelper(`MOSTRA_WIN_HELPER names ${override}, which doesn't exist.`);
  }
  if (runtime === undefined) {
    throw missingHelper("No runtime was resolved, so Mostra's Windows helper can't be found.");
  }
  const candidates =
    runtime.bundle !== undefined
      ? [join(runtime.bundle.root, "bin", "mostra-win.exe")]
      : ["release", "debug"].map((profile) =>
          resolve(
            dirname(runtime.runtimeEntry),
            "..",
            "..",
            "..",
            "target",
            profile,
            "mostra-win.exe",
          ),
        );
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw missingHelper(
      `Mostra's Windows helper isn't installed; looked for ${candidates.join(", ")}.`,
    );
  }
  return found;
}

function missingHelper(message: string): RpcError {
  return new RpcError(createDiagnostic("MOSTRA_ENV_HELPER_MISSING", { message }));
}

/**
 * Connects to a home's control endpoint. Rejects with `MOSTRA_HOST_CONNECTION_CLOSED` when nothing
 * serves it in time or, on Windows, when another user owns the pipe; with
 * `MOSTRA_ENV_HELPER_MISSING` when the Windows helper can't be found.
 */
export function connectControl(endpoint: string, options: ControlOptions = {}): Promise<Duplex> {
  const timeoutMs = options.timeoutMs ?? 5000;
  if ((options.platform ?? process.platform) === "win32") {
    return connectPipe(
      endpoint,
      windowsHelper(options.runtime, options.env ?? process.env),
      timeoutMs,
    );
  }
  return new Promise((resolvePromise, reject) => {
    const socket: Socket = createConnection(endpoint);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(unreachable(endpoint, "timed out"));
    }, timeoutMs);
    socket.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(unreachable(endpoint, error.code ?? "failed"));
    });
    socket.once("connect", () => {
      clearTimeout(timer);
      resolvePromise(socket);
    });
  });
}

function connectPipe(endpoint: string, helper: string, timeoutMs: number): Promise<Duplex> {
  const name = endpoint.startsWith(PIPE_PREFIX) ? endpoint.slice(PIPE_PREFIX.length) : endpoint;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(helper, ["connect", name], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let settled = false;
    const fail = (why: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(unreachable(endpoint, why));
    };
    const timer = setTimeout(() => fail("timed out"), timeoutMs);
    child.once("error", (error) => fail(error.message));
    child.once("exit", (code) =>
      fail(code === NOT_OWNED_EXIT ? "another user owns that pipe" : `the helper exited ${code}`),
    );
    let text = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (settled) return;
      text += chunk;
      const end = text.indexOf("\n");
      if (end < 0) return;
      let line: { connected?: boolean; code?: string; error?: string } = {};
      try {
        line = JSON.parse(text.slice(0, end)) as typeof line;
      } catch {
        // Treated as a failure below.
      }
      if (line.connected !== true) {
        fail(
          line.code === "not-owned"
            ? "another user owns that pipe"
            : (line.error ?? text.slice(0, end)),
        );
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolvePromise(Duplex.from({ readable: child.stdout, writable: child.stdin }));
    });
  });
}
