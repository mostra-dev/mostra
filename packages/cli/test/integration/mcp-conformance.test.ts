/**
 * The MCP conformance suites (MC-01's check, D164) against `mostra mcp --http` and a real daemon:
 * `@modelcontextprotocol/conformance` 0.1.16 for the 2025-era protocol, and 0.2.0-alpha.12 at the
 * 2026-07-28 revision, each with a committed baseline that names every expected failure and why
 * (`test/fixtures/mcp-conformance/`). A new failure, or an entry that starts passing, fails it.
 *
 * The suites can't send headers, and the server requires its bearer token, so they reach it
 * through a loopback proxy that adds `Authorization` and forwards everything else as received:
 * the server's request checks still judge every request (the DNS-rebinding scenarios' foreign
 * `Host` arrives as sent).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { createServer, request, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { BIN, type TestHome, testHome } from "../support.ts";

const TOKEN = "K".repeat(32);
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

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** `mostra mcp --http` with the token, and its URL. */
async function startServer(at: TestHome): Promise<string> {
  const server: ChildProcess = spawn(process.execPath, [BIN, "mcp", "--http", "--json"], {
    env: { ...at.env, MOSTRA_MCP_TOKEN: TOKEN },
    stdio: ["ignore", "pipe", "pipe"],
  });
  cleanups.push(async () => {
    if (server.exitCode === null) server.kill("SIGTERM");
    await new Promise((done) =>
      server.exitCode !== null ? done(undefined) : server.once("exit", done),
    );
  });
  return new Promise((resolve, reject) => {
    let out = "";
    server.stdout?.setEncoding("utf8");
    server.stdout?.on("data", (chunk: string) => {
      out += chunk;
      const line = out.split("\n").find((entry) => entry.includes('"listening"'));
      if (line) resolve((JSON.parse(line) as { event: { url: string } }).event.url);
    });
    server.once("exit", (code) => reject(new Error(`mostra mcp --http exited ${code}`)));
  });
}

/** The proxy: adds the token, maps its own Host and Origin to the server's, forwards the rest. */
async function bearerProxy(target: string): Promise<string> {
  const upstream = new URL(target);
  const proxy: Server = createServer((req, res) => {
    const own = `127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    const headers: [string, string][] = [];
    for (let index = 0; index + 1 < req.rawHeaders.length; index += 2) {
      const name = req.rawHeaders[index] as string;
      let value = req.rawHeaders[index + 1] as string;
      const lower = name.toLowerCase();
      if (lower === "authorization") continue;
      if (lower === "host" && value === own) value = upstream.host;
      if (lower === "origin" && value === `http://${own}`) value = upstream.origin;
      headers.push([name, value]);
    }
    headers.push(["Authorization", `Bearer ${TOKEN}`]);
    const forward = request(
      {
        host: upstream.hostname,
        port: upstream.port,
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
    forward.on("error", () => res.writeHead(502).end());
    req.pipe(forward);
  });
  await new Promise<void>((done) => proxy.listen(0, "127.0.0.1", done));
  cleanups.push(
    () =>
      new Promise((done) => {
        proxy.closeAllConnections();
        proxy.close(() => done());
      }),
  );
  return `http://127.0.0.1:${(proxy.address() as AddressInfo).port}${upstream.pathname}`;
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

describe("MCP conformance (MC-01)", () => {
  for (const [name, bin, baseline, extra] of [
    ["the 2025-era suite (0.1.16)", SUITES.stable, "2025.yml", []],
    [
      "the 2026-07-28 suite (0.2.0-alpha.12)",
      SUITES.next,
      "2026-07-28.yml",
      ["--spec-version", "2026-07-28"],
    ],
  ] as const) {
    it(`passes ${name}, failing only what its baseline names`, { timeout: 600_000 }, async () => {
      const at = testHome();
      cleanups.push(() => at.cleanup());
      const url = await bearerProxy(await startServer(at));
      const { code, output } = await runSuite(
        bin,
        [
          "--url",
          url,
          "--suite",
          "all",
          ...extra,
          "--expected-failures",
          join(FIXTURES, baseline),
          "-o",
          join(at.root, "results"),
        ],
        at.root,
      );
      // The scenarios Mostra's own surface decides always run and pass.
      for (const scenario of ["tools-list", "resources-list", "dns-rebinding-protection"]) {
        expect(output, scenario).toMatch(new RegExp(`✓ ${scenario}: [1-9]`));
      }
      expect(code, output.slice(-4000)).toBe(0);
    });
  }
});
