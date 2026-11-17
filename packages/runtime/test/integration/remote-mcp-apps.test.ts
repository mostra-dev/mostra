/**
 * MCP Apps in cloud chat hosts (WP-17, D175 item 8, MC-02 and MC-04's inline round trip): a real
 * `mostra-runtime server`, a real owner instance linked to it, and an MCP client holding a token
 * got through the whole OAuth flow, as claude.ai's connector holds one. `artifact_open` names the
 * loader and hands the page its hosted link; the owner sends each version's page after its push,
 * the server keeps it and serves it while the owner sleeps, and asks the owner for one it lacks;
 * the page's app-only tools act on the hosted home as the signed-in account; and a chat host
 * whose policy shows links only (D160) is given no MCP Apps at all.
 */
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GatewayHome } from "../gateway-home.ts";
import { mcpAccessToken } from "../oauth-support.ts";
import {
  freePort,
  loopbackFetch,
  ownerEnv,
  ownerSignIn,
  type RunningServer,
  startServer,
  stopServer,
  testConfig,
} from "../server-support.ts";
import { tempDir } from "../support.ts";

const PAGE = `import { defineArtifact, useField } from "@mostra/react";

export const artifact = defineArtifact({ title: "Inline in a chat host" });

export default function Page() {
  const [day, setDay] = useField("day", "", { label: "Which day?", required: true });
  return <input aria-label="Which day?" value={day} onChange={(event) => setDay(event.target.value)} />;
}
`;

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean; structured: Record<string, unknown> | undefined }> {
  const result = await client.callTool({ name, arguments: args }, { timeout: 240_000 });
  const content = result.content as { type: string; text?: string }[];
  return {
    text: content.find((part) => part.type === "text")?.text ?? "",
    isError: result.isError === true,
    structured: result.structuredContent as Record<string, unknown> | undefined,
  };
}

/** Every file under `dir` whose name is `name`. */
function find(dir: string, name: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...find(path, name));
    else if (entry === name) found.push(path);
  }
  return found;
}

async function until<T>(
  read: () => Promise<T | undefined> | T | undefined,
  ms = 60_000,
): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe("MCP Apps through the remote MCP server (D175 item 8)", () => {
  let port: number;
  let data: string;
  let server: RunningServer;
  let owner: GatewayHome;
  let accessToken: string;
  const clients: Client[] = [];

  const connect = async (): Promise<Client> => {
    const client = new Client({ name: "chat-host", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://api.localhost:${port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
        fetch: loopbackFetch,
      }),
    );
    clients.push(client);
    return client;
  };

  beforeAll(async () => {
    port = await freePort();
    data = tempDir("mcp-apps-data");
    server = await startServer({ data, port });
    expect(server.status.status, server.stderr()).toBe("started");
    owner = new GatewayHome();
    await owner.start({
      env: { ...ownerEnv(port), MOSTRA_MCP_WORKSPACE: tempDir("mcp-apps-workspace") },
    });
    await ownerSignIn(owner.client, port, "Ada");
    accessToken = await mcpAccessToken(port, "Ada");
  }, 120_000);

  afterAll(async () => {
    for (const client of clients) await client.close().catch(() => undefined);
    await owner?.stop();
    await stopServer(server);
  });

  it("shows a hosted page inline: its page made on the server, its answers saved and submitted as the account", async () => {
    const client = await connect();
    const tools = (await client.listTools()).tools;
    expect(tools.filter((tool) => tool.name.startsWith("app_"))).toHaveLength(11);
    const open = tools.find((tool) => tool.name === "artifact_open");
    expect((open?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui?.resourceUri).toBe(
      "ui://mostra/app",
    );

    const created = JSON.parse(
      (await call(client, "artifact_create", { title: "Inline" })).text,
    ) as {
      dir: string;
    };
    const written = await call(client, "artifact_write", {
      dir: created.dir,
      files: [{ path: "index.tsx", content: PAGE }],
    });
    expect(written.isError, written.text).toBe(false);
    const published = await call(client, "artifact_publish", { dir: created.dir });
    expect(published.isError, published.text).toBe(false);
    const receipt = JSON.parse(published.text) as { artifactId: string; versionId: string };

    const opened = await call(client, "artifact_open", { artifact: receipt.artifactId });
    const handles = (opened.structured as { mostra?: Record<string, unknown> }).mostra as {
      artifactId: string;
      versionId: string;
      url: string;
    };
    expect(handles.artifactId).toBe(receipt.artifactId);
    expect(handles.versionId).toBe(receipt.versionId);
    expect(new URL(handles.url).host).toBe(`content.localhost:${port}`);

    // The server makes the version's page itself, from the version's own files, when a chat host
    // first reads it, and keeps it (D175 item 8): no page arrives from the owner.
    expect(find(data, `${receipt.versionId}.json`)).toHaveLength(0);
    const read = await client.readResource({ uri: `ui://mostra/view/${receipt.versionId}` });
    const page = read.contents[0] as { mimeType?: string; text?: string };
    expect(page.mimeType).toBe("text/html;profile=mcp-app");
    expect(page.text).toContain('<meta name="mostra-target" content="mcp-app" />');
    expect(page.text).toContain(`<meta name="mostra-version" content="${receipt.versionId}" />`);
    expect(find(data, `${receipt.versionId}.json`)).toHaveLength(1);

    // The page's own tools act on the hosted home, as the signed-in account.
    const view = await call(client, "app_open", {
      artifactId: receipt.artifactId,
      url: handles.url,
    });
    expect(view.isError, view.text).toBe(false);
    const session = (
      view.structured as { session: string; viewId: string; viewer?: { kind: string } }
    ).session;
    const viewId = (view.structured as { viewId: string }).viewId;
    expect((view.structured as { viewer?: { kind: string } }).viewer?.kind).toBe("account");
    const saved = await call(client, "app_fields", {
      artifactId: receipt.artifactId,
      session,
      body: {
        mutationId: "mut_01JZ0000000000000000000001",
        scope: "viewer",
        baseRevision: "0",
        viewId,
        ops: [{ id: "day", value: "Thursday" }],
      },
    });
    expect((saved.structured as { status: number }).status, saved.text).toBe(200);
    const submitted = await call(client, "app_submit", {
      artifactId: receipt.artifactId,
      session,
      body: { viewId, expectedRevision: "1", channel: "artifact" },
    });
    expect((submitted.structured as { status: number }).status, submitted.text).toBe(200);
    const waited = JSON.parse(
      (
        await call(client, "artifact_wait", {
          artifact: receipt.artifactId,
          until: "submitted",
          timeoutSeconds: 30,
        })
      ).text,
    ) as { status: string };
    expect(waited.status).toBe("satisfied");
    // The owner's own ledger holds the answer, imported from the hosted home (RM-02).
    const results = await until(async () => {
      const answer = (await owner.client.call("results/get", {
        artifact: { artifactId: receipt.artifactId },
      })) as { result?: { answers: Record<string, unknown>; submission: { channel: string } } };
      return answer.result;
    });
    expect(results.answers).toEqual({ day: "Thursday" });
    expect(results.submission.channel).toBe("artifact");

    // While the owner sleeps, the page still shows: kept, and made again from the version's
    // files when the kept one is lost, the same page (R01-2: never a page anyone sent).
    await owner.stop();
    const asleep = await client.readResource({ uri: `ui://mostra/view/${receipt.versionId}` });
    expect((asleep.contents[0] as { text?: string }).text).toBe(page.text);
    for (const file of find(data, `${receipt.versionId}.json`)) rmSync(file);
    const again = await client.readResource({ uri: `ui://mostra/view/${receipt.versionId}` });
    expect((again.contents[0] as { text?: string }).text).toBe(page.text);
    expect(find(data, `${receipt.versionId}.json`)).toHaveLength(1);
  }, 400_000);
});

describe("a chat host whose policy shows links only (D160)", () => {
  let port: number;
  let server: RunningServer;
  let accessToken: string;
  let client: Client | undefined;

  beforeAll(async () => {
    port = await freePort();
    server = await startServer({
      data: tempDir("mcp-links-data"),
      port,
      // The test's MCP client redirects to client.example.
      config: testConfig(port, { chatHosts: { "client.example": { render: "link" } } }),
    });
    expect(server.status.status, server.stderr()).toBe("started");
    accessToken = await mcpAccessToken(port, "Bo");
  }, 120_000);

  afterAll(async () => {
    await client?.close().catch(() => undefined);
    await stopServer(server);
  });

  it("lists no app-only tools, names no loader, and serves no pages", async () => {
    client = new Client({ name: "links-only", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://api.localhost:${port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
        fetch: loopbackFetch,
      }),
    );
    const tools = (await client.listTools()).tools;
    expect(tools.map((tool) => tool.name).filter((name) => name.startsWith("app_"))).toEqual([]);
    expect(tools).toHaveLength(13);
    const open = tools.find((tool) => tool.name === "artifact_open");
    expect((open?._meta as { ui?: unknown } | undefined)?.ui).toBeUndefined();
    const listed = (await client.listResources()).resources.map((resource) => resource.uri);
    expect(listed).not.toContain("ui://mostra/app");
  }, 120_000);

  it("refuses a configuration whose chat host policy it can't use", async () => {
    const bad = await startServer({
      data: tempDir("mcp-links-bad"),
      port: await freePort(),
      config: testConfig(port, { chatHosts: { "client.example": { render: "frame" } } }),
    });
    expect(bad.status.status).toBe("failed");
    expect(JSON.stringify(bad.status)).toContain("MOSTRA_REMOTE_CONFIG_INVALID");
    await stopServer(bad);
  }, 60_000);
});
