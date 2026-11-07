/**
 * The remote server's core (WP-29, D165 items 0b, 6; FAILURE_MODEL §11.2): `mostra-runtime server`
 * holds its data directory with `server.lock`, so a second server refuses it and a killed one's
 * lock is gone at once; it refuses a data directory on a network filesystem and a configuration it
 * can't use, naming the key; and it routes by the exact `Host`, dropping cookies.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { networkFilesystem } from "../../src/platform/index.ts";
import {
  freePort,
  type RunningServer,
  send,
  startServer,
  stopServer,
  testConfig,
} from "../server-support.ts";
import { tempDir } from "../support.ts";

const running: RunningServer[] = [];
afterEach(async () => {
  for (const server of running.splice(0)) await stopServer(server);
});

async function started(options: Parameters<typeof startServer>[0]): Promise<RunningServer> {
  const server = await startServer(options);
  running.push(server);
  return server;
}

describe("mostra-runtime server's data directory (D165 item 0b)", () => {
  it("starts, answers on the API origin, and stops cleanly", async () => {
    const port = await freePort();
    const server = await started({ data: tempDir("server-data"), port });
    expect(server.status).toMatchObject({ status: "started", address: `http://127.0.0.1:${port}` });
    const health = await send(port, `api.localhost:${port}`, "/health");
    expect(health.status).toBe(200);
    expect(JSON.parse(health.body)).toMatchObject({ status: "ok" });
    // Windows has no SIGTERM between processes: there the kill ends it, and Ctrl+C or Ctrl+Break
    // at its console is the clean stop (D150 item 6).
    const code = await stopServer(server);
    if (process.platform !== "win32") expect(code).toBe(0);
  });

  it("refuses a second server on one data directory, and frees it the moment the first is killed", async () => {
    const data = tempDir("server-data");
    const first = await started({ data, port: await freePort() });
    expect(first.status.status).toBe("started");
    const second = await startServer({ data, port: await freePort() });
    expect(second.status).toMatchObject({
      status: "failed",
      diagnostic: { code: "MOSTRA_HOME_LOCKED" },
    });
    expect(await second.exited).toBe(3);
    // A crashed server leaves no stale lock: the operating system released it with the process.
    first.child.kill("SIGKILL");
    await first.exited;
    const third = await started({ data, port: await freePort() });
    expect(third.status.status).toBe("started");
  });

  it("refuses a data directory on a network filesystem before it opens anything", async () => {
    const data = tempDir("server-nfs");
    const server = await startServer({
      data,
      port: await freePort(),
      env: { MOSTRA_TEST_NETWORK_FILESYSTEM: data },
    });
    expect(server.status).toMatchObject({
      status: "failed",
      diagnostic: { code: "MOSTRA_HOME_NETWORK_FILESYSTEM" },
    });
    expect(await server.exited).toBe(3);
  });

  it("refuses a configuration it can't use, naming the key", async () => {
    const port = await freePort();
    const cases: [Record<string, unknown>, RegExp][] = [
      [testConfig(port, { apiOrigin: "http://api.example" }), /apiOrigin/],
      [testConfig(port, { apiOrigin: `http://content.localhost:${port}` }), /user-content domain/],
      [testConfig(port, { relay: { waitingRunsPerArtifact: 0 } }), /relay\.waitingRunsPerArtifact/],
      [testConfig(port, { surprise: true }), /surprise|configuration/],
    ];
    for (const [config, named] of cases) {
      const server = await startServer({ data: tempDir("server-config-bad"), port, config });
      expect(server.status.status).toBe("failed");
      expect(server.status.diagnostic?.code).toBe("MOSTRA_REMOTE_CONFIG_INVALID");
      expect(server.status.diagnostic?.message).toMatch(named);
      expect(await server.exited).toBe(3);
    }
  });

  it("routes by the exact Host: an unknown host gets 421, and nothing is served without a route", async () => {
    const port = await freePort();
    await started({ data: tempDir("server-data"), port });
    const unknown = await send(port, `elsewhere.localhost:${port}`, "/health");
    expect(unknown.status).toBe(421);
    expect(JSON.parse(unknown.body)).toMatchObject({ code: "MOSTRA_HYGIENE_HOST_REFUSED" });
    const apex = await send(port, `content.localhost:${port}`, "/health", {
      headers: { cookie: "mostra-1=tossed" },
    });
    expect(apex.status).toBe(404);
    expect(apex.headers["set-cookie"]).toBeUndefined();
    expect(apex.headers["cross-origin-resource-policy"]).toBe("same-origin");
  });

  it("finds no network filesystem under a local temporary directory", async () => {
    expect(networkFilesystem(tempDir("server-local"))).toBeUndefined();
  });

  it("needs --data", async () => {
    const child = spawn(
      process.execPath,
      [join(import.meta.dirname, "../../dist/bin.js"), "server"],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    expect(code).toBe(2);
    expect(stderr).toContain("--data");
  });
});
