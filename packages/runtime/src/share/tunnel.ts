/**
 * A tunnel tool's process (D158 item 4): `tailscale serve`, `tailscale funnel` or `cloudflared`,
 * started through the process manager (recorded, gated, reaped after a crash, RT-09), its output
 * read line by line until it says it serves, fails, or runs out of time. A tunnel that serves
 * keeps running until it is stopped; `ended` says when it ends by itself.
 */
import { createDiagnostic, type Diagnostic, RpcError } from "@mostra/protocol";
import type { Log } from "../log.ts";
import type { ChildHandle, ProcessManager } from "../processes/index.ts";

/** What a tunnel's output line means while it starts. */
export type LineVerdict =
  | { readonly kind: "serving"; readonly origin?: string }
  | { readonly kind: "origin"; readonly origin: string }
  | { readonly kind: "failed"; readonly diagnostic: Diagnostic }
  | undefined;

/** A tunnel that serves. */
export interface Tunnel {
  /** The tunnel's external origin. */
  readonly origin: string;
  /** Resolves when the tunnel's process ends by itself (a stop doesn't resolve it). */
  readonly ended: Promise<{ readonly code: number | null; readonly lines: readonly string[] }>;
  /** Stops the tunnel's process. */
  stop(): Promise<void>;
}

/** Options for {@link runTunnel}. */
export interface TunnelOptions {
  readonly processes: ProcessManager;
  readonly log: Log;
  /** The child's kind in the process manager's records. */
  readonly kind: string;
  /** What it serves (a face's key). */
  readonly ownerRef: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Reads each line of output: it serves, it names its address, it failed, or nothing yet. */
  readonly read: (line: string) => LineVerdict;
  /** The origin when the tool never names one (Tailscale's comes from the device's name). */
  readonly origin?: string;
  /** How long it may take to serve. */
  readonly timeoutMs: number;
  /** What the tunnel is, for messages: "Tailscale Serve", "a Cloudflare quick tunnel". */
  readonly label: string;
}

const TAIL = 20;

/** Starts a tunnel tool and resolves once it serves; rejects with a `MOSTRA_SHARE_*` RpcError. */
export async function runTunnel(options: TunnelOptions): Promise<Tunnel> {
  const lines: string[] = [];
  let origin = options.origin;
  let settle: ((outcome: { ok: true } | { ok: false; diagnostic: Diagnostic }) => void) | undefined;
  const settled = new Promise<{ ok: true } | { ok: false; diagnostic: Diagnostic }>((resolve) => {
    settle = resolve;
  });
  let serving = false;
  const onLine = (line: string): void => {
    lines.push(line);
    if (lines.length > TAIL) lines.shift();
    if (serving) return;
    const verdict = options.read(line);
    if (verdict === undefined) return;
    if (verdict.kind === "origin") {
      origin = verdict.origin;
      return;
    }
    if (verdict.kind === "failed") {
      settle?.({ ok: false, diagnostic: verdict.diagnostic });
      return;
    }
    if (verdict.origin !== undefined) origin = verdict.origin;
    if (origin !== undefined) {
      serving = true;
      settle?.({ ok: true });
    }
  };
  let child: ChildHandle;
  try {
    child = await options.processes.spawn({
      kind: options.kind,
      ownerRef: options.ownerRef,
      command: options.command,
      args: options.args,
      env: options.env,
      onStdout: onLine,
      onStderr: onLine,
    });
  } catch (error) {
    throw new RpcError(
      createDiagnostic("MOSTRA_SHARE_TOOL_NOT_READY", {
        message: `${options.label} couldn't start: ${(error as Error).message}`,
      }),
    );
  }
  let stopping = false;
  const exited = child.exited.then((exit) => {
    if (!serving) {
      settle?.({
        ok: false,
        diagnostic: createDiagnostic("MOSTRA_SHARE_TUNNEL_FAILED", {
          message: `${options.label} ended before it served (exit ${exit.code ?? exit.signal}): ${lastWords(lines)}`,
        }),
      });
    }
    return exit;
  });
  const timer = setTimeout(() => {
    settle?.({
      ok: false,
      diagnostic: createDiagnostic("MOSTRA_SHARE_TUNNEL_FAILED", {
        message: `${options.label} didn't serve within ${Math.round(options.timeoutMs / 1000)} s: ${lastWords(lines)}`,
      }),
    });
  }, options.timeoutMs);
  const outcome = await settled;
  clearTimeout(timer);
  if (!outcome.ok) {
    stopping = true;
    await child.stop(3000).catch(() => undefined);
    throw new RpcError(outcome.diagnostic);
  }
  options.log.info("share.tunnel_serving", { kind: options.kind, owner: options.ownerRef, origin });
  const ended = exited.then(
    (exit) =>
      new Promise<{ code: number | null; lines: readonly string[] }>((resolve) => {
        if (!stopping) resolve({ code: exit.code, lines: [...lines] });
      }),
  );
  return {
    origin: origin as string,
    ended,
    async stop() {
      stopping = true;
      await child.stop(3000).catch(() => undefined);
    },
  };
}

/** The last meaningful lines of a tool's output, for a message. */
function lastWords(lines: readonly string[]): string {
  const meaningful = lines.filter((line) => line.trim() !== "").slice(-3);
  return meaningful.length === 0 ? "it said nothing" : meaningful.join(" / ").slice(0, 600);
}

/**
 * Runs a tool to its end and resolves with its standard output (a status query), or rejects with
 * `MOSTRA_SHARE_TOOL_NOT_READY` naming what it said.
 */
export async function runToCompletion(options: {
  readonly processes: ProcessManager;
  readonly kind: string;
  readonly ownerRef: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs: number;
  readonly label: string;
}): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let child: ChildHandle;
  try {
    child = await options.processes.spawn({
      kind: options.kind,
      ownerRef: options.ownerRef,
      command: options.command,
      args: options.args,
      env: options.env,
      onStdout: (line) => stdout.push(line),
      onStderr: (line) => stderr.push(line),
    });
  } catch (error) {
    throw new RpcError(
      createDiagnostic("MOSTRA_SHARE_TOOL_NOT_READY", {
        message: `${options.label} couldn't start: ${(error as Error).message}`,
      }),
    );
  }
  const timer = setTimeout(() => void child.stop(1000), options.timeoutMs);
  const exit = await child.exited;
  clearTimeout(timer);
  return { code: exit.code, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
}
