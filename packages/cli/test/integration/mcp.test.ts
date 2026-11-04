/**
 * `mostra mcp` (MC-01, D164) through the built binary and a real daemon: an agent's whole session
 * over stdio from create to results, the same tools over Streamable HTTP on both protocol eras,
 * the HTTP request checks against the real listener (HY-01 item 13), D148's embedded marker, and
 * a daemon that restarts under a running server.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  BIN,
  type Collector,
  cli,
  collector,
  eventually,
  type TestHome,
  testHome,
  Viewer,
} from "../support.ts";

const homes: TestHome[] = [];
const clients: Client[] = [];
const servers: ChildProcess[] = [];
let fake: Collector;
beforeAll(async () => {
  fake = await collector();
});
afterAll(async () => {
  await fake.close();
});
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  for (const server of servers.splice(0)) {
    if (server.exitCode === null) server.kill("SIGTERM");
    await new Promise((done) =>
      server.exitCode !== null ? done(undefined) : server.once("exit", done),
    );
  }
  for (const home of homes.splice(0)) await home.cleanup();
  fake.requests.splice(0);
});

/**
 * `mostra mcp --http --json` started on `at`, once it listens: the URL from stdout's `listening`
 * event, and the bearer token from stderr (generated, or `MOSTRA_MCP_TOKEN`).
 */
async function httpServer(
  at: TestHome,
): Promise<{ url: string; token: string; stdout: () => string }> {
  const server = spawn(process.execPath, [BIN, "mcp", "--http", "--json"], {
    env: at.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  servers.push(server);
  let out = "";
  let err = "";
  server.stdout?.setEncoding("utf8");
  server.stderr?.setEncoding("utf8");
  return await new Promise((resolve, reject) => {
    const check = (): void => {
      const line = out.split("\n").find((entry) => entry.includes('"listening"'));
      const given = at.env["MOSTRA_MCP_TOKEN"];
      const token = given ?? /Bearer ([A-Za-z0-9_-]{26,}) /.exec(err)?.[1];
      if (line === undefined || token === undefined) return;
      const { url } = (JSON.parse(line) as { event: { url: string } }).event;
      resolve({ url, token, stdout: () => out });
    };
    server.stdout?.on("data", (chunk: string) => {
      out += chunk;
      check();
    });
    server.stderr?.on("data", (chunk: string) => {
      err += chunk;
      check();
    });
    server.once("exit", (code) => reject(new Error(`mostra mcp --http exited ${code}: ${err}`)));
  });
}

function home(extra: Record<string, string> = {}): TestHome {
  const made = testHome(extra);
  homes.push(made);
  return made;
}

/** A client of `mostra mcp` over stdio, as a harness starts it. */
async function stdioClient(
  at: TestHome,
  args: string[] = [],
  name = "mostra-test",
): Promise<Client> {
  const client = new Client({ name, version: "9.9.9" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [BIN, "mcp", ...args],
      env: at.env,
      stderr: "pipe",
    }),
  );
  clients.push(client);
  return client;
}

/** Calls a tool and returns its text and the whole result. */
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text?: string }[];
  return { result, text: content.find((block) => block.type === "text")?.text ?? "" };
}

const PAGE = (id: string) => `import { defineArtifact, useField } from "@mostra/react";

export const artifact = defineArtifact({ id: "${id}", title: "Name, please", submission: { policy: "once" } });

export default function Page() {
  const [name, setName] = useField("name", "", { label: "Your name", required: true });
  return (
    <main className="p-8">
      <label>
        Your name <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
    </main>
  );
}
`;

describe("mostra mcp", () => {
  it("takes an agent from create to results over stdio, through the tools alone", async () => {
    // The real gate: publish runs verify (D41), as an agent's publish does.
    const at = home({ MOSTRA_TEST_UNVERIFIED_PUBLISH: "", MOSTRA_MCP_WORKSPACE: "" });
    const client = await stdioClient(at, ["--workspace", join(at.root, "ws")]);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(13);
    expect(client.getInstructions()).toContain(join(at.root, "ws"));

    const created = JSON.parse(
      (await call(client, "artifact_create", { title: "Name, please" })).text,
    ) as {
      artifactId: string;
      dir: string;
      files: string[];
    };
    // The instance names a directory by its native real path: links followed (macOS's /tmp is
    // /private/tmp), and on Windows short 8.3 names such as RUNNER~1 written out (D151 item 5).
    mkdirSync(join(at.root, "ws"), { recursive: true });
    expect(created.dir).toBe(join(realpathSync.native(join(at.root, "ws")), "name-please"));
    expect(created.files).toEqual(expect.arrayContaining(["index.tsx", "AGENTS.md"]));

    const written = await call(client, "artifact_write", {
      dir: "name-please",
      files: [{ path: "index.tsx", content: PAGE(created.artifactId).replace("p-8", "p-6") }],
    });
    expect(written.result.isError).toBeFalsy();
    const patched = await call(client, "artifact_patch", {
      dir: created.dir,
      path: "index.tsx",
      edits: [{ old: "p-6", new: "p-8" }],
    });
    expect(JSON.parse(patched.text)).toMatchObject({ patched: ["index.tsx"] });
    const rejected = await call(client, "artifact_patch", {
      dir: created.dir,
      path: "index.tsx",
      edits: [{ old: "not in the file", new: "x" }],
    });
    expect(rejected.result.isError).toBe(true);
    expect(JSON.parse(rejected.text)).toMatchObject({
      error: { code: "MOSTRA_ARTIFACT_PATCH_REJECTED" },
      rejected: [{ edit: 0, reason: "not-found" }],
    });
    expect(readFileSync(join(created.dir, "index.tsx"), "utf8")).toBe(PAGE(created.artifactId));

    const verified = await call(client, "artifact_verify", {
      dir: created.dir,
      screenshots: "always",
    });
    expect(JSON.parse(verified.text)).toMatchObject({ status: "pass" });
    const images = (verified.result.content as { type: string; mimeType?: string }[]).filter(
      (block) => block.type === "image",
    );
    expect(images).toHaveLength(2);
    expect(images[0]?.mimeType).toBe("image/png");

    const receipt = JSON.parse(
      (await call(client, "artifact_publish", { dir: created.dir })).text,
    ) as {
      version: number;
      url: string;
    };
    expect(receipt.version).toBe(1);
    const link = JSON.parse(
      (await call(client, "artifact_open", { artifact: created.artifactId })).text,
    ) as {
      url: string;
    };
    expect(link.url).toBe(receipt.url);

    const pending = JSON.parse(
      (
        await call(client, "artifact_wait", {
          artifact: created.artifactId,
          until: "submitted",
          timeoutSeconds: 0,
        })
      ).text,
    ) as { status: string; cursor: string };
    expect(pending.status).toBe("still_waiting");
    const noResults = await call(client, "artifact_results", { artifact: created.artifactId });
    expect(JSON.parse(noResults.text)).toMatchObject({
      error: { code: "MOSTRA_SUBMIT_NOT_FOUND" },
    });

    // The person answers in the page while the agent waits.
    const waiting = call(client, "artifact_wait", {
      artifact: created.dir,
      until: "submitted",
      after: pending.cursor,
      timeoutSeconds: 50,
    });
    const viewer = await new Viewer().open(link.url);
    const submitted = await viewer.answerAndSubmit({ name: "Ada Lovelace" });
    expect(submitted.status).toBe(200);
    expect(JSON.parse((await waiting).text)).toMatchObject({ status: "satisfied" });

    const markdown = await call(client, "artifact_results", { artifact: created.artifactId });
    // The test's viewer writes the field without its label, as a page with no label would.
    expect(markdown.text).toMatch(/^# Name, please: submission sub_/);
    expect(markdown.text).toContain("Ada Lovelace");
    const json = JSON.parse(
      (await call(client, "artifact_results", { artifact: created.artifactId, format: "json" }))
        .text,
    );
    expect(json.answers).toEqual({ name: "Ada Lovelace" });

    const listed = JSON.parse((await call(client, "artifact_list", {})).text) as {
      artifacts: { id: string }[];
    };
    expect(listed.artifacts.map((artifact) => artifact.id)).toContain(created.artifactId);
    const report = await client.readResource({
      uri: `mostra://artifacts/${created.artifactId}/report`,
    });
    expect((report.contents[0] as { text: string }).text).toContain("Ada Lovelace");
    const guide = await call(client, "docs_search", { topic: "guide" });
    expect(guide.text).toContain("Read through Mostra's MCP server");
  });

  it("serves shared state and live values to an agent", async () => {
    const at = home();
    const client = await stdioClient(at);
    const created = JSON.parse(
      (await call(client, "artifact_create", { title: "Board" })).text,
    ) as {
      artifactId: string;
      dir: string;
    };
    await call(client, "artifact_write", {
      dir: created.dir,
      files: [{ path: "index.tsx", content: PAGE(created.artifactId) }],
    });
    await call(client, "artifact_publish", { dir: created.dir });
    const patched = JSON.parse(
      (
        await call(client, "state_patch", {
          artifact: created.artifactId,
          ops: [{ id: "priorities", value: ["ship"] }],
        })
      ).text,
    ) as { revision: string };
    expect(patched.revision).toBeDefined();
    const state = JSON.parse(
      (await call(client, "state_get", { artifact: created.artifactId })).text,
    );
    expect(JSON.stringify(state)).toContain("ship");
    const pushed = await call(client, "live_push", {
      artifact: created.artifactId,
      key: "visitors",
      value: 3,
    });
    expect(pushed.result.isError).toBeFalsy();
  });

  it("serves the same tools over Streamable HTTP to both protocol eras, behind its token", async () => {
    const listening = await httpServer(home());
    expect(new URL(listening.url).hostname).toBe("127.0.0.1");
    expect(listening.token.length).toBeGreaterThanOrEqual(26);
    // The generated token is printed once, on stderr: never on stdout, which a supervisor may
    // keep in a log (D164 item 3, Opus review of WP-15, finding 8).
    expect(listening.stdout()).not.toContain(listening.token);
    expect(listening.stdout()).toContain('"listening"');
    for (const era of ["modern", "legacy"] as const) {
      const client = new Client(
        { name: `http-${era}`, version: "1.0.0" },
        era === "modern" ? { versionNegotiation: { mode: "auto" } } : {},
      );
      await client.connect(
        new StreamableHTTPClientTransport(new URL(listening.url), {
          requestInit: { headers: { Authorization: `Bearer ${listening.token}` } },
        }),
      );
      clients.push(client);
      expect(client.getProtocolEra()).toBe(era);
      expect((await client.listTools()).tools).toHaveLength(13);
      const listed = await call(client, "artifact_list", {});
      expect(JSON.parse(listed.text)).toEqual({ artifacts: [] });
    }
    const refused = new Client({ name: "no-token", version: "1.0.0" });
    await expect(
      refused.connect(new StreamableHTTPClientTransport(new URL(listening.url))),
    ).rejects.toThrow();
  });

  it("refuses requests a stranger's page or a wrong token could send, on the real listener (HY-01 item 13)", async () => {
    const at = home({ MOSTRA_MCP_TOKEN: "S7kq2ZpXw9mRb4LvN0cTj6hY3dFg" });
    const server = spawn(process.execPath, [BIN, "mcp", "--http", "--json"], {
      env: at.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    servers.push(server);
    const url = await new Promise<string>((resolve) => {
      let out = "";
      server.stdout?.setEncoding("utf8");
      server.stdout?.on("data", (chunk: string) => {
        out += chunk;
        const line = out.split("\n").find((entry) => entry.includes('"listening"'));
        if (line) {
          const event = (JSON.parse(line) as { event: { url: string; token?: string } }).event;
          // A token the environment chose is never printed.
          expect(event.token).toBeUndefined();
          resolve(event.url);
        }
      });
    });
    const { port } = new URL(url);
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const send = (headers: Record<string, string>, method = "POST", path = "/mcp") =>
      new Promise<{ status: number; headers: Record<string, unknown> }>((resolve, reject) => {
        const req = httpRequest(
          { host: "127.0.0.1", port, method, path, headers, setHost: false },
          (res) => {
            res.resume();
            res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
          },
        );
        req.on("error", reject);
        req.end(method === "POST" ? body : undefined);
      });
    const good = {
      host: `127.0.0.1:${port}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: "Bearer S7kq2ZpXw9mRb4LvN0cTj6hY3dFg",
    };
    const ok = await send(good);
    expect(ok.status).toBe(200);
    // The scheme is case-insensitive (RFC 9110; Opus review of WP-15, finding 10).
    expect(
      (await send({ ...good, authorization: "bearer S7kq2ZpXw9mRb4LvN0cTj6hY3dFg" })).status,
    ).toBe(200);
    expect(ok.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(Object.keys(ok.headers).some((name) => name.startsWith("access-control-"))).toBe(false);
    expect((await send({ ...good, host: `evil.example:${port}` })).status).toBe(421);
    expect((await send({ ...good, host: `localhost:${port}` })).status).toBe(421);
    expect((await send({ ...good, origin: "http://evil.example" })).status).toBe(403);
    expect((await send({ ...good, "content-type": "text/plain" })).status).toBe(415);
    const { authorization: _token, ...noToken } = good;
    expect((await send(noToken)).status).toBe(401);
    expect((await send({ ...good, authorization: "Bearer wrong" })).status).toBe(401);
    expect((await send(good, "GET")).status).toBe(405);
    expect((await send(good, "OPTIONS")).status).toBe(405);
    expect((await send(good, "POST", "/other")).status).toBe(404);
  });

  it("refuses a wider bind without --url-host, and HTTP flags without --http", async () => {
    const at = home();
    const wide = await cli(["mcp", "--http", "--bind", "0.0.0.0", "--json"], { env: at.env });
    expect(wide.code).toBe(3);
    expect(wide.stdout).toContain("MOSTRA_ENV_BIND_FAILED");
    const usage = await cli(["mcp", "--port", "4000", "--json"], { env: at.env });
    expect(usage.code).toBe(2);
    const timeout = await cli(["mcp", "--timeout", "5s", "--json"], { env: at.env });
    expect(timeout.code).toBe(2);
  });

  it("answers again after the daemon restarts under it", async () => {
    const at = home();
    const client = await stdioClient(at);
    expect(JSON.parse((await call(client, "artifact_list", {})).text)).toEqual({ artifacts: [] });
    expect((await cli(["daemon", "stop", "--json"], { env: at.env })).code).toBe(0);
    const again = await call(client, "artifact_list", {});
    expect(again.result.isError).toBeFalsy();
    expect(JSON.parse(again.text)).toEqual({ artifacts: [] });
  });

  describe("telemetry (D119, D148)", () => {
    const telemetryHome = (): TestHome =>
      home({
        MOSTRA_TELEMETRY_ENDPOINT: fake.url,
        TZ: "America/New_York",
        MOSTRA_TEST_LOCALTIME: "",
        MOSTRA_TEST_FLUSH_INTERVAL_MS: "0",
      });
    const events = (): { event: string; client?: string; clientVersion?: string }[] =>
      fake.requests.flatMap((request) => (JSON.parse(request.body) as { events: never[] }).events);

    it("counts each MCP client of the standalone CLI once, by its known ID", async () => {
      const at = telemetryHome();
      const client = await stdioClient(at, [], "claude-code");
      await call(client, "artifact_list", {});
      await call(client, "artifact_list", {});
      await eventually(() => events().some((event) => event.event === "mcp.session"));
      const sessions = events().filter((event) => event.event === "mcp.session");
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ client: "claude-code", clientVersion: "9.9.9" });
    });

    it("counts a 2025-era client over HTTP that only lists the tools (Opus review of WP-15, finding 2)", async () => {
      const at = telemetryHome();
      at.env["MOSTRA_MCP_TOKEN"] = "Tq7Z0123456789abcdefghijklmnop";
      const listening = await httpServer(at);
      const client = new Client({ name: "codex-mcp-client", version: "0.162.1" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(listening.url), {
          requestInit: { headers: { Authorization: `Bearer ${listening.token}` } },
        }),
      );
      clients.push(client);
      expect(client.getProtocolEra()).toBe("legacy");
      await client.listTools();
      await client.listTools();
      await eventually(() => events().some((event) => event.event === "mcp.session"));
      const sessions = events().filter((event) => event.event === "mcp.session");
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ client: "codex", clientVersion: "0.162.1" });
    });

    it("sends nothing from a server a harness plugin starts (--embedded), whatever the consent", async () => {
      const at = telemetryHome();
      at.env["MOSTRA_TELEMETRY"] = "1";
      const client = await stdioClient(at, ["--embedded"], "claude-code");
      await call(client, "artifact_list", {});
      await call(client, "docs_search", { query: "fields" });
      await client.close();
      clients.splice(clients.indexOf(client), 1);
      // Give a flusher every chance to have started and sent.
      await new Promise((done) => setTimeout(done, 3000));
      expect(fake.requests).toHaveLength(0);
      expect(existsSync(join(at.config, "telemetry-queue.ndjson"))).toBe(false);
      expect(existsSync(join(at.config, "telemetry-id"))).toBe(false);
    });
  });
});
