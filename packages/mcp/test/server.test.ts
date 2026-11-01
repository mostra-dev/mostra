import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMcpServerFactory, localWorkspace, type McpServerOptions } from "@mostra/mcp";
import { createDiagnostic, RpcError } from "@mostra/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { fakeDocs, fakeInstance } from "./support.ts";

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const item of opened.splice(0)) await item.close();
});

/** A client connected in process to the server built from `options`, on the era it asks for. */
async function connect(
  options: McpServerOptions,
  era: "modern" | "legacy" = "modern",
): Promise<Client> {
  const handler = createMcpHandler(createMcpServerFactory(options));
  const client = new Client(
    { name: "test-harness", version: "1.2.3" },
    era === "modern" ? { versionNegotiation: { mode: "auto" } } : {},
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    }),
  );
  opened.push(client, handler);
  return client;
}

function text(result: unknown): string {
  const content = (result as { content: { type: string; text?: string }[] }).content;
  return content.find((block) => block.type === "text")?.text ?? "";
}

function base(answers: Parameters<typeof fakeInstance>[0] = {}) {
  const root = mkdtempSync(join(tmpdir(), "mostra-mcp-"));
  const instance = fakeInstance(answers);
  const options: McpServerOptions = {
    instance,
    workspace: localWorkspace(root),
    docs: fakeDocs,
    version: "0.0.0-test",
  };
  return { root, instance, options };
}

describe("the MCP server", () => {
  it("lists thirteen tools with short names, descriptions and input schemas, on both eras", async () => {
    for (const era of ["modern", "legacy"] as const) {
      const client = await connect(base().options, era);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toEqual([
        "artifact_create",
        "artifact_write",
        "artifact_patch",
        "artifact_verify",
        "artifact_publish",
        "artifact_open",
        "artifact_wait",
        "artifact_results",
        "artifact_list",
        "live_push",
        "state_get",
        "state_patch",
        "docs_search",
      ]);
      for (const tool of tools) {
        expect(tool.name.length).toBeLessThanOrEqual(64);
        expect(tool.description?.length ?? 0).toBeGreaterThan(40);
        expect(tool.inputSchema.type).toBe("object");
      }
      expect(client.getInstructions()).toContain("artifact_verify");
    }
  });

  it("caps artifact_wait at 50 seconds and passes it on in milliseconds", async () => {
    const { options, instance } = base({ wait: () => ({ status: "still_waiting", cursor: "7" }) });
    const client = await connect(options);
    const refused = await client.callTool({
      name: "artifact_wait",
      arguments: {
        artifact: "art_01JZ0000000000000000000000",
        until: "submitted",
        timeoutSeconds: 51,
      },
    });
    expect(refused.isError).toBe(true);
    expect(instance.calls).toHaveLength(0);
    const waited = await client.callTool({
      name: "artifact_wait",
      arguments: { artifact: "art_01JZ0000000000000000000000", until: "submitted", after: "3" },
    });
    expect(JSON.parse(text(waited))).toEqual({ status: "still_waiting", cursor: "7" });
    expect(instance.calls[0]).toEqual({
      method: "wait",
      params: {
        artifact: { artifactId: "art_01JZ0000000000000000000000" },
        until: "submitted",
        after: "3",
        timeoutMs: 50_000,
      },
    });
  });

  it("hands the instance's diagnostic to the model as an isError result", async () => {
    const { options } = base({
      "results/get": () => {
        throw new RpcError(
          createDiagnostic("MOSTRA_SUBMIT_NOT_FOUND", { message: "Nothing submitted yet." }),
        );
      },
    });
    const client = await connect(options);
    const result = await client.callTool({
      name: "artifact_results",
      arguments: { artifact: "my-page" },
    });
    expect(result.isError).toBe(true);
    const body = JSON.parse(text(result)) as {
      error: { code: string; hint?: string; docs: string };
    };
    expect(body.error.code).toBe("MOSTRA_SUBMIT_NOT_FOUND");
    expect(body.error.docs).toContain("MOSTRA_SUBMIT_NOT_FOUND");
  });

  it("resolves relative directories inside the workspace and returns Markdown results", async () => {
    const { options, instance, root } = base({
      "results/get": () => ({ submissionId: "sub_x", markdown: "# Results\n\nBudget: 3" }),
    });
    const client = await connect(options);
    const result = await client.callTool({
      name: "artifact_results",
      arguments: { artifact: "my-page" },
    });
    expect(text(result)).toBe("# Results\n\nBudget: 3");
    expect(instance.calls[0]?.params).toEqual({
      artifact: { path: join(root, "my-page") },
      format: "md",
    });
  });

  it("creates an artifact in a new workspace folder named after its title", async () => {
    const { options, instance, root } = base({
      "artifact/create": (params) => ({
        artifactId: "art_X",
        dir: params["dir"],
        files: ["index.tsx"],
      }),
    });
    const client = await connect(options);
    await client.callTool({ name: "artifact_create", arguments: { title: "Sidebar: your call" } });
    expect(instance.calls[0]?.params).toEqual({
      dir: join(root, "sidebar-your-call"),
      title: "Sidebar: your call",
    });
  });

  it("returns the screenshots verify marks, as images, and reports its stages as progress", async () => {
    const root = mkdtempSync(join(tmpdir(), "mostra-mcp-shot-"));
    const png = join(root, "1280x800.png");
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const verdict = {
      status: "fail",
      screenshots: [
        { viewport: "1280x800", path: png, returned: true },
        { viewport: "390x844", path: join(root, "missing.png"), returned: false },
      ],
      diagnostics: [],
    };
    const { options } = base({
      "artifact/verify": (_params, progress) => {
        progress("compile");
        progress("render");
        return verdict;
      },
    });
    const client = await connect(options);
    const stages: string[] = [];
    const result = await client.callTool(
      { name: "artifact_verify", arguments: { dir: "/tmp/x" } },
      { onprogress: (update) => stages.push(String(update.message)) },
    );
    const content = result.content as { type: string; data?: string; mimeType?: string }[];
    expect(JSON.parse(text(result)).status).toBe("fail");
    expect(content.filter((block) => block.type === "image")).toEqual([
      { type: "image", mimeType: "image/png", data: "iVBORw==" },
    ]);
    expect(stages).toEqual(["verify: compile", "verify: render"]);
  });

  it("tells whoever counts sessions which client each server instance serves", async () => {
    const told: unknown[] = [];
    const { options } = base({ "artifact/list": () => ({ artifacts: [] }) });
    const client = await connect({ ...options, onClient: (client) => told.push(client) });
    await client.callTool({ name: "artifact_list", arguments: {} });
    await client.callTool({ name: "artifact_list", arguments: {} });
    // Over HTTP each request is its own instance; over stdio one connection is (counted per process).
    expect(told.length).toBeGreaterThan(0);
    for (const client of told) expect(client).toEqual({ name: "test-harness", version: "1.2.3" });
  });

  it("serves the reference as resources and through docs_search", async () => {
    const { options } = base({ "artifact/list": () => ({ artifacts: [] }) });
    const client = await connect(options);
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining(["mostra://docs/guide", "mostra://docs/guide/answers"]),
    );
    expect(resources.map((resource) => resource.uri)).not.toContain(
      "mostra://docs/MOSTRA_FIELD_DUPLICATE_ID",
    );
    const read = await client.readResource({ uri: "mostra://docs/MOSTRA_FIELD_DUPLICATE_ID" });
    expect((read.contents[0] as { text: string }).text).toContain("Two fields share one ID");
    const search = await client.callTool({
      name: "docs_search",
      arguments: { query: "submit button" },
    });
    expect(JSON.parse(text(search)).hits[0]).toMatchObject({
      topic: "guide/answers",
      uri: "mostra://docs/guide/answers",
    });
    const whole = await client.callTool({ name: "docs_search", arguments: { topic: "guide" } });
    expect(text(whole)).toContain("Every answer is a field");
  });

  it("gives a new link for one person, and the default link otherwise", async () => {
    const link = { url: "http://127.0.0.1:1/a/art_X#t=s", tokenId: "tok_1", scopes: ["view"] };
    const { options, instance } = base({ "view/default": () => link, "view/url": () => link });
    const client = await connect(options);
    await client.callTool({
      name: "artifact_open",
      arguments: { artifact: "art_01JZ0000000000000000000000" },
    });
    await client.callTool({
      name: "artifact_open",
      arguments: {
        artifact: "art_01JZ0000000000000000000000",
        viewer: { ref: "ada@example.com", name: "Ada" },
      },
    });
    expect(instance.calls.map((call) => call.method)).toEqual(["view/default", "view/url"]);
    expect(instance.calls[1]?.params).toMatchObject({
      viewer: { ref: "ada@example.com", name: "Ada" },
    });
  });
});
