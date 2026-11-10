/**
 * The MCP conformance suites against the remote MCP endpoint (MC-04's check, D165 item 10): a real
 * `mostra-runtime server`, an owner instance signed in as its default, and an MCP client signed in
 * through the server's own authorization server (registration, PKCE S256, consent, a token for the
 * resource `/mcp`). `@modelcontextprotocol/conformance` 0.1.16 for the 2025-era protocol and
 * 0.2.0-alpha.12 at the 2026-07-28 revision run through `/mcp`, each with a committed baseline that
 * names every expected failure and why (`test/fixtures/mcp-conformance/`); a new failure, or an
 * entry that starts passing, fails it.
 *
 * The suites can't send headers, so they reach the server through a loopback proxy that adds the
 * client's bearer token and names the API origin's `Host`, as the server routes by it; everything
 * else arrives as the suite sent it, so the server's checks judge every request.
 */
import { spawn } from "node:child_process";
import { createServer, request, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GatewayHome } from "../gateway-home.ts";
import { mcpAccessToken } from "../oauth-support.ts";
import {
  freePort,
  ownerEnv,
  ownerSignIn,
  type RunningServer,
  startServer,
  stopServer,
  testConfig,
} from "../server-support.ts";
import { tempDir } from "../support.ts";

const FIXTURES = fileURLToPath(new URL("../fixtures/mcp-conformance/", import.meta.url));
const require = createRequire(import.meta.url);
/** Each suite's command line, as its package's `bin` names it. */
const SUITES = {
  stable: join(
    dirname(require.resolve("@modelcontextprotocol/conformance/package.json")),
    "dist",
    "index.js",
  ),
  next: join(
    dirname(require.resolve("@modelcontextprotocol/conformance-next/package.json")),
    "dist",
    "index.js",
  ),
};

/** The proxy: adds the client's token and the API origin's `Host`, forwards the rest as sent. */
async function bearerProxy(port: number, token: string): Promise<{ url: string; server: Server }> {
  const apiHost = `api.localhost:${port}`;
  const proxy: Server = createServer((req, res) => {
    const own = `127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    const headers: [string, string][] = [];
    for (let index = 0; index + 1 < req.rawHeaders.length; index += 2) {
      const name = req.rawHeaders[index] as string;
      let value = req.rawHeaders[index + 1] as string;
      const lower = name.toLowerCase();
      if (lower === "authorization") continue;
      if (lower === "host" && value === own) value = apiHost;
      headers.push([name, value]);
    }
    headers.push(["Authorization", `Bearer ${token}`]);
    const forward = request(
      {
        host: "127.0.0.1",
        port,
        method: req.method,
        path: req.url,
        headers: headers.flat(),
        setHost: false,
      },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
        answer.pipe(res);
      },
    );
    forward.on("error", () => {
      if (res.headersSent) res.destroy();
      else res.writeHead(502).end();
    });
    req.on("aborted", () => forward.destroy());
    res.on("close", () => forward.destroy());
    req.pipe(forward);
  });
  await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
  return { url: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}/mcp`, server: proxy };
}

/** Runs a suite; its exit code and output. */
function runSuite(
  bin: string,
  args: string[],
  cwd: string,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const run = spawn(process.execPath, [bin, "server", ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    run.stdout.on("data", (chunk) => {
      output += chunk;
    });
    run.stderr.on("data", (chunk) => {
      output += chunk;
    });
    run.on("exit", (code) => resolve({ code, output }));
  });
}

describe("MCP conformance of the remote endpoint (MC-04)", () => {
  let port: number;
  let server: RunningServer;
  let proxy: { url: string; server: Server };
  const owner = new GatewayHome();

  beforeAll(async () => {
    port = await freePort();
    server = await startServer({
      data: tempDir("remote-conformance"),
      port,
      config: testConfig(port),
    });
    expect(server.status.status, server.stderr()).toBe("started");
    // The account's default instance, so the tools that author reach an owner.
    await owner.start({ env: ownerEnv(port) });
    await ownerSignIn(owner.client, port, "Ada");
    proxy = await bearerProxy(port, await mcpAccessToken(port, "Ada"));
  }, 240_000);

  afterAll(async () => {
    proxy?.server.closeAllConnections();
    proxy?.server.close();
    await owner.stop();
    await stopServer(server);
  });

  for (const [name, bin, baseline, extra] of [
    ["the 2025-era suite (0.1.16)", SUITES.stable, "2025.yml", []],
    [
      "the 2026-07-28 suite (0.2.0-alpha.12)",
      SUITES.next,
      "2026-07-28.yml",
      ["--spec-version", "2026-07-28"],
    ],
  ] as const) {
    it(`passes ${name} through /mcp, failing only what its baseline names`, {
      timeout: 600_000,
    }, async () => {
      const root = tempDir("remote-conformance-run");
      const { code, output } = await runSuite(
        bin,
        [
          "--url",
          proxy.url,
          "--suite",
          "all",
          ...extra,
          "--expected-failures",
          join(FIXTURES, baseline),
          "-o",
          join(root, "results"),
        ],
        root,
      );
      for (const scenario of ["tools-list", "resources-list", "dns-rebinding-protection"]) {
        expect(output, scenario).toMatch(new RegExp(`✓ ${scenario}: [1-9]`));
      }
      expect(code, output.slice(-4000)).toBe(0);
    });
  }
});
