/**
 * A remote server the kit runs for the remote scenarios (WP-29, INTERFACES §18): `mostra-runtime
 * server` from the runtime the host uses, on loopback, with a development identity provider, and
 * the host's instance signed in to it by the device grant, the person approving on the server's
 * device page as a browser would.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { join } from "node:path";
import { resolveRuntime } from "@mostra/sdk";
import type { ScenarioContext } from "./scenario.ts";

/** A running server: its API origin, its port, and the variables an instance needs to reach it. */
export interface RemoteServer {
  /** `http://api.localhost:<port>`: the binding, version files and sign-in. */
  readonly origin: string;
  /** The loopback port it listens on. */
  readonly port: number;
  /**
   * What an instance of this run needs to reach it: `*.localhost` is this machine, and the
   * server listens on 127.0.0.1 alone (`MOSTRA_TEST_SERVER_ADDRESS`).
   */
  readonly env: Readonly<Record<string, string>>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

/** Starts a server for `context`, stopped when the scenario ends. */
export async function startRemoteServer(context: ScenarioContext): Promise<RemoteServer> {
  const port = await freePort();
  const dir = join(context.dir, "server");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const config = join(dir, "server.json");
  writeFileSync(
    config,
    JSON.stringify({
      apiOrigin: `http://api.localhost:${port}`,
      domains: { active: `content.localhost:${port}` },
      scheme: "http",
      identityProviders: [{ id: "dev", kind: "development", label: "Development sign-in" }],
    }),
  );
  const env = { ...process.env, ...context.settings.hostEnv };
  const runtime = await resolveRuntime({ env });
  const child: ChildProcess = spawn(
    runtime.node,
    [
      runtime.runtimeEntry,
      "server",
      "--data",
      join(dir, "data"),
      "--config",
      config,
      "--listen",
      `127.0.0.1:${port}`,
    ],
    { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  context.defer(async () => {
    if (child.exitCode === null) {
      child.kill();
      const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
      await exited;
      clearTimeout(timer);
    }
  });
  await new Promise<void>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(
      () => reject(new Error("the remote server didn't start in 60 s")),
      60_000,
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      const line = out.split("\n")[0];
      if (!out.includes("\n") || line === undefined) return;
      clearTimeout(timer);
      const status = JSON.parse(line) as { status: string };
      if (status.status === "started") resolve();
      else reject(new Error(`the remote server didn't start: ${line}`));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`the remote server exited with ${code}`));
    });
  });
  return {
    origin: `http://api.localhost:${port}`,
    port,
    env: { MOSTRA_TEST_SERVER_ADDRESS: `127.0.0.1:${port}` },
  };
}

/** Posts a form to the server as its own device page does (with its own `Origin`). */
function postForm(
  server: RemoteServer,
  path: string,
  fields: Record<string, string>,
): Promise<{ status: number; body: string }> {
  const body = new URLSearchParams(fields).toString();
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: server.port,
        method: "POST",
        path,
        headers: {
          host: new URL(server.origin).host,
          origin: server.origin,
          "content-type": "application/x-www-form-urlencoded",
          "content-length": Buffer.byteLength(body),
        },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.setTimeout(30_000, () => req.destroy(new Error(`${path} didn't answer in 30 s`)));
    req.on("error", reject);
    req.end(body);
  });
}

/**
 * Signs the host's instance in to `server` through the host (`remote/login`, then
 * `remote/login.wait`), approving the code on the device page as `name`; the instance's link.
 */
export async function signIn(
  context: ScenarioContext,
  server: RemoteServer,
  name = "Ada",
): Promise<{ readonly instanceId: string }> {
  const started = await context.host.call<{ loginId: string; userCode: string }>("remote/login", {
    server: server.origin,
  });
  const approved = await postForm(server, "/device", {
    user_code: started.userCode,
    name,
    provider: "dev",
    decision: "approve",
  });
  if (approved.status !== 200) {
    throw new Error(`the device page refused the approval: ${approved.status}`);
  }
  const waited = await context.host.call<{ status: string; instanceId: string }>(
    "remote/login.wait",
    { loginId: started.loginId, timeoutMs: 30_000 },
    40_000,
  );
  if (waited.status !== "signed-in") throw new Error(`remote/login.wait: ${waited.status}`);
  return { instanceId: waited.instanceId };
}
