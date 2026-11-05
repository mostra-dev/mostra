/**
 * Test support for the remote server (WP-29): starting a real `mostra-runtime server` on a scratch
 * data directory, with a configuration whose API origin and user-content domain are loopback
 * names on one port, and requests sent to it with an exact `Host`.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";
import { BIN, tempDir } from "./support.ts";

/** A free loopback port, found by binding one and releasing it. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** A server's status line on stdout. */
export interface ServerStatus {
  readonly status: "started" | "failed";
  readonly pid?: number;
  readonly address?: string;
  readonly diagnostic?: { readonly code: string; readonly message: string };
}

/** A running (or failed) `mostra-runtime server`. */
export interface RunningServer {
  readonly child: ChildProcess;
  readonly status: ServerStatus;
  readonly exited: Promise<number | null>;
  readonly stderr: () => string;
}

/** The configuration a test server runs with: loopback names on its port. */
export function testConfig(
  port: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    apiOrigin: `http://api.localhost:${port}`,
    domains: { active: `content.localhost:${port}` },
    scheme: "http",
    identityProviders: [{ id: "dev", kind: "development", label: "Development sign-in" }],
    ...extra,
  };
}

/** Starts `mostra-runtime server` and waits for its status line. */
export async function startServer(options: {
  readonly data: string;
  readonly port: number;
  readonly config?: Record<string, unknown>;
  readonly env?: NodeJS.ProcessEnv;
  readonly args?: readonly string[];
}): Promise<RunningServer> {
  const configFile = join(tempDir("server-config", true), "server.json");
  writeFileSync(configFile, JSON.stringify(options.config ?? testConfig(options.port)));
  const child = spawn(
    process.execPath,
    [
      BIN,
      "server",
      "--data",
      options.data,
      "--config",
      configFile,
      "--listen",
      `127.0.0.1:${options.port}`,
      ...(options.args ?? []),
    ],
    { env: { ...process.env, ...options.env }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<number | null>((resolve) =>
    child.once("exit", (code) => resolve(code)),
  );
  const status = await new Promise<ServerStatus>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`no status line: ${stderr}`)), 30_000);
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      out += chunk;
      const line = out.split("\n")[0];
      if (out.includes("\n") && line !== undefined) {
        clearTimeout(timer);
        resolve(JSON.parse(line) as ServerStatus);
      }
    });
    void exited.then((code) => {
      if (!out.includes("\n")) {
        clearTimeout(timer);
        reject(new Error(`server exited (${String(code)}) before a status line: ${stderr}`));
      }
    });
  });
  return { child, status, exited, stderr: () => stderr };
}

/** Stops a server with SIGTERM and waits for it. */
export async function stopServer(server: RunningServer): Promise<number | null> {
  if (server.child.exitCode !== null) return server.child.exitCode;
  server.child.kill("SIGTERM");
  return server.exited;
}

/** A response: its status, headers and body text. */
export interface Reply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

/** Sends a request to 127.0.0.1:`port` with an exact `Host`. */
export async function send(
  port: number,
  host: string,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string | Buffer } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: init.method ?? "GET",
        headers: { host, ...init.headers },
      },
      (incoming) => {
        let body = "";
        incoming.setEncoding("utf8");
        incoming.on("data", (chunk: string) => {
          body += chunk;
        });
        incoming.on("end", () =>
          resolve({ status: incoming.statusCode ?? 0, headers: incoming.headers, body }),
        );
      },
    );
    outgoing.on("error", reject);
    if (init.body !== undefined) outgoing.write(init.body);
    outgoing.end();
  });
}
