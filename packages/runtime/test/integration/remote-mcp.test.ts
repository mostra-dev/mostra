/**
 * The remote MCP server (MC-04, INTERFACES §18.8, D165 items 5, 10): `@mostra/mcp`'s tools at
 * `<apiOrigin>/mcp` over Streamable HTTP, behind the authorization server. A real
 * `mostra-runtime server`, a real owner instance linked to it as the account's default instance,
 * and an MCP client holding a token got through the whole OAuth flow: the tool set is the local
 * server's; reading tools act on the hosted home; authoring is relayed to the owner, in its own
 * workspace; a publish answers the hosted link, which a person opens and answers; without a
 * connected instance authoring answers `MOSTRA_REMOTE_NO_INSTANCE` while reading keeps working.
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Browser, openLink } from "../browser-client.ts";
import { GatewayHome } from "../gateway-home.ts";
import { mcpAccessToken } from "../oauth-support.ts";
import {
  freePort,
  ownerSignIn,
  type RunningServer,
  send,
  startServer,
  stopServer,
} from "../server-support.ts";
import { tempDir } from "../support.ts";

const REVISION = "2026-10-15";

/** A tool's result: its text, and whether it is an error. */
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name, arguments: args }, { timeout: 240_000 });
  const content = result.content as { type: string; text?: string }[];
  return {
    text: content.find((part) => part.type === "text")?.text ?? "",
    isError: result.isError === true,
  };
}

describe("the remote MCP server (MC-04)", () => {
  let port: number;
  let server: RunningServer;
  let owner: GatewayHome;
  let workspace: string;
  let accessToken: string;
  const clients: Client[] = [];

  const connect = async (token: string): Promise<Client> => {
    const client = new Client({ name: "remote-test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://api.localhost:${port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    clients.push(client);
    return client;
  };

  beforeAll(async () => {
    port = await freePort();
    server = await startServer({ data: tempDir("mcp-data"), port });
    expect(server.status.status, server.stderr()).toBe("started");
    workspace = tempDir("mcp-workspace");
    owner = new GatewayHome();
    await owner.start({ env: { MOSTRA_MCP_WORKSPACE: workspace } });
    await ownerSignIn(owner.client, port, "Ada");
    accessToken = await mcpAccessToken(port, "Ada");
  }, 120_000);

  afterAll(async () => {
    for (const client of clients) await client.close().catch(() => undefined);
    await owner?.stop();
    await stopServer(server);
  });

  it("answers 401 with resource_metadata without a token, and refuses a binding's token", async () => {
    const bare = await send(port, `api.localhost:${port}`, "/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(bare.status).toBe(401);
    expect(String(bare.headers["www-authenticate"])).toContain(
      `resource_metadata="http://api.localhost:${port}/.well-known/oauth-protected-resource/mcp"`,
    );
    const forged = await send(port, `api.localhost:${port}`, "/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer not-a-token-of-this-server-at-all",
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(forged.status).toBe(401);
  });

  it("serves the local server's tools, authors through the owner, and answers the hosted link", async () => {
    const client = await connect(accessToken);
    const tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
    expect(tools).toHaveLength(13);
    expect(tools).toContain("artifact_publish");
    expect(JSON.parse((await call(client, "artifact_list", {})).text)).toEqual({ artifacts: [] });

    // Created in the owner's own workspace, relayed (D165 item 5).
    const created = await call(client, "artifact_create", { title: "Remote review" });
    expect(created.isError, created.text).toBe(false);
    const made = JSON.parse(created.text) as { artifactId: string; dir: string };
    expect(made.dir.startsWith(workspace)).toBe(true);

    // A directory outside the owner's workspace is refused on the owner.
    const outside = await call(client, "artifact_write", {
      dir: tempDir("elsewhere"),
      files: [{ path: "index.tsx", content: "export default () => null;" }],
    });
    expect(outside.isError).toBe(true);
    expect(outside.text).toContain("MOSTRA_ARTIFACT_PATH_INVALID");

    const published = await call(client, "artifact_publish", { dir: made.dir });
    expect(published.isError, published.text).toBe(false);
    const receipt = JSON.parse(published.text) as { artifactId: string; url: string };
    expect(receipt.artifactId).toBe(made.artifactId);
    // The hosted link, on the user-content domain, never the owner's loopback.
    expect(new URL(receipt.url).host).toBe(`content.localhost:${port}`);

    const opened = JSON.parse(
      (await call(client, "artifact_open", { artifact: made.artifactId })).text,
    ) as {
      url: string;
    };
    expect(opened.url).toBe(receipt.url);

    // A person opens the hosted link and answers; the chat host reads the answer back.
    const browser = new Browser();
    const page = await openLink(browser, opened.url);
    const submitted = await browser.fetchJson(
      page.link.shell,
      `${new URL(opened.url).pathname}/_mostra/v/${REVISION}/submit`,
      { body: { viewId: page.viewId, expectedRevision: "0" }, csrf: page.shellCsrf },
    );
    expect(submitted.status, submitted.body).toBe(200);
    const waited = JSON.parse(
      (
        await call(client, "artifact_wait", {
          artifact: made.artifactId,
          until: "submitted",
          timeoutSeconds: 20,
        })
      ).text,
    ) as { status: string };
    expect(waited.status).toBe("satisfied");
    const results = await call(client, "artifact_results", {
      artifact: made.artifactId,
      format: "json",
    });
    expect(results.isError, results.text).toBe(false);
    // The directory names the artifact through its owner, for reading tools too.
    const byDir = await call(client, "artifact_results", { artifact: made.dir, format: "json" });
    expect(byDir.isError, byDir.text).toBe(false);
  }, 300_000);

  it("answers MOSTRA_REMOTE_NO_INSTANCE for authoring with no instance connected, and keeps reading", async () => {
    await owner.stop();
    const client = await connect(accessToken);
    const created = await call(client, "artifact_create", { title: "No instance" });
    expect(created.isError).toBe(true);
    expect(created.text).toContain("MOSTRA_REMOTE_NO_INSTANCE");
    // Reading needs no instance: the hosted home answers.
    const listed = await call(client, "artifact_list", {});
    expect(listed.isError, listed.text).toBe(false);
    expect(Array.isArray((JSON.parse(listed.text) as { artifacts: unknown }).artifacts)).toBe(true);
  }, 120_000);
});
