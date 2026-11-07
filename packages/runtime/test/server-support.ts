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

/** Sends a form to the API origin. */
export function postForm(
  port: number,
  path: string,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Reply> {
  return send(port, `api.localhost:${port}`, path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

/** Tokens a sign-in gave. */
export interface SignedIn {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accountId: string;
  readonly instanceId: string;
}

/**
 * Signs in by the device grant as `name` through the development provider, as `mostra login` and
 * a person on the device page would: start, approve on the page, then redeem the code.
 */
export async function deviceSignIn(
  port: number,
  name: string,
  extra: Record<string, string> = {},
): Promise<SignedIn> {
  const started = await postForm(port, "/oauth/device", { client_id: "mostra-cli", ...extra });
  if (started.status !== 200) throw new Error(`device: ${started.status} ${started.body}`);
  const device = JSON.parse(started.body) as { device_code: string; user_code: string };
  const approved = await postForm(
    port,
    "/device",
    { user_code: device.user_code, name, provider: "dev", decision: "approve" },
    { origin: `http://api.localhost:${port}` },
  );
  if (approved.status !== 200) throw new Error(`approve: ${approved.status} ${approved.body}`);
  const token = await postForm(port, "/oauth/token", {
    client_id: "mostra-cli",
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: device.device_code,
  });
  if (token.status !== 200) throw new Error(`token: ${token.status} ${token.body}`);
  const answer = JSON.parse(token.body) as {
    access_token: string;
    refresh_token: string;
    mostra_account: { id: string };
    mostra_instance: string;
  };
  return {
    accessToken: answer.access_token,
    refreshToken: answer.refresh_token,
    accountId: answer.mostra_account.id,
    instanceId: answer.mostra_instance,
  };
}

/** The environment an owner instance needs to reach a test server on loopback (D166). */
export function ownerEnv(port: number): NodeJS.ProcessEnv {
  return { MOSTRA_TEST_SERVER_ADDRESS: `127.0.0.1:${port}` };
}

/** A client that answers host-protocol calls, as `GatewayHome.client` does. */
interface Caller {
  call(
    method: string,
    params: unknown,
    timeoutMs?: number,
  ): Promise<{ result?: unknown; error?: unknown }>;
}

/**
 * Signs an owner instance in to a test server as a person would with `mostra login`: the instance
 * starts the device grant, the person approves the code on the server's page through the
 * development provider, and the instance's wait ends.
 */
export async function ownerSignIn(
  client: Caller,
  port: number,
  name = "Ada",
): Promise<{ instanceId: string; account: { id: string; name?: string } }> {
  const server = `http://api.localhost:${port}`;
  const started = await client.call("remote/login", { server });
  if (!started.result) throw new Error(`remote/login: ${JSON.stringify(started.error)}`);
  const { loginId, userCode } = started.result as { loginId: string; userCode: string };
  const approved = await postForm(
    port,
    "/device",
    { user_code: userCode, name, provider: "dev", decision: "approve" },
    { origin: server },
  );
  if (approved.status !== 200) throw new Error(`approve: ${approved.status} ${approved.body}`);
  const waited = await client.call("remote/login.wait", { loginId, timeoutMs: 30_000 }, 40_000);
  const result = waited.result as {
    status: string;
    instanceId: string;
    account: { id: string; name?: string };
  };
  if (result?.status !== "signed-in")
    throw new Error(`remote/login.wait: ${JSON.stringify(waited)}`);
  return result;
}
