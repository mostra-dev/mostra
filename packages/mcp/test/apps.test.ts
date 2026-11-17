/**
 * MCP Apps through the MCP server (D175 items 1 and 5, MC-02): the app-only tools, the loader and
 * the versions' pages, `artifact_open`'s UI metadata and handles, and what a client without MCP
 * Apps is left without.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler, InMemoryTransport } from "@modelcontextprotocol/server";
import { createMcpServerFactory, localWorkspace, type McpServerOptions } from "@mostra/mcp";
import {
  createDiagnostic,
  MCP_APP_MIME_TYPE,
  MCP_APPS_EXTENSION,
  RpcError,
} from "@mostra/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { LOADER_WORDS } from "../src/loader.ts";
import { fakeDocs, fakeInstance } from "./support.ts";

const ARTIFACT = "art_01JB8Z3QF6S7W3N8D5K2C4V9XG";
const VERSION = "ver_0123456789ABCDEFGHJKMNPQRS";
const LINK = `http://127.0.0.1:20001/a/${ARTIFACT}#t=SECRETSECRETSECRETSECRET12`;

const opened: { close(): Promise<void> }[] = [];
afterEach(async () => {
  for (const item of opened.splice(0)) await item.close();
});

function base(
  answers: Parameters<typeof fakeInstance>[0] = {},
  extra: Partial<McpServerOptions> = {},
) {
  const instance = fakeInstance(answers);
  const options: McpServerOptions = {
    instance,
    workspace: localWorkspace(mkdtempSync(join(tmpdir(), "mostra-mcp-apps-"))),
    docs: fakeDocs,
    version: "0.0.0-test",
    ...extra,
  };
  return { instance, options };
}

/** A client over HTTP: a 2026-07-28 request names no capabilities the tool list could read. */
async function overHttp(options: McpServerOptions): Promise<Client> {
  const handler = createMcpHandler(createMcpServerFactory(options));
  const client = new Client(
    { name: "test-host", version: "1" },
    { versionNegotiation: { mode: "auto" } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    }),
  );
  opened.push(client, handler);
  return client;
}

/** Every message a session's server sent, in order (`overSession`). */
const sentBy = new WeakMap<Client, { method?: string }[]>();

/** A client over one session (as stdio is), with the capabilities it names. */
async function overSession(options: McpServerOptions, apps: boolean): Promise<Client> {
  const server = createMcpServerFactory(options)({ era: "legacy" });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const sent: { method?: string }[] = [];
  const send = serverSide.send.bind(serverSide);
  serverSide.send = (message, sendOptions) => {
    sent.push(message as { method?: string });
    return send(message, sendOptions);
  };
  await (await server).connect(serverSide);
  const client = new Client(
    { name: "test-host", version: "1" },
    {
      capabilities: apps
        ? ({ extensions: { [MCP_APPS_EXTENSION]: { mimeTypes: [MCP_APP_MIME_TYPE] } } } as never)
        : {},
    },
  );
  await client.connect(clientSide);
  opened.push(client);
  sentBy.set(client, sent);
  return client;
}

const uiOf = (tool: { _meta?: unknown }) =>
  (tool._meta as { ui?: { visibility?: string[]; resourceUri?: string } } | undefined)?.ui;

describe("MCP Apps through the MCP server (D175, MC-02)", () => {
  it("lists the page's tools as app-only and names the loader on artifact_open", async () => {
    const client = await overHttp(base().options);
    const { tools } = await client.listTools();
    const apps = tools.filter((tool) => tool.name.startsWith("app_"));
    expect(apps).toHaveLength(11);
    for (const tool of apps) expect(uiOf(tool)?.visibility, tool.name).toEqual(["app"]);
    const open = tools.find((tool) => tool.name === "artifact_open");
    expect(uiOf(open ?? {})?.resourceUri).toBe("ui://mostra/app");
    expect((open?._meta as Record<string, unknown> | undefined)?.["ui/resourceUri"]).toBe(
      "ui://mostra/app",
    );
    // No tool the model sees is app-only.
    for (const tool of tools.filter((tool) => !tool.name.startsWith("app_"))) {
      expect(uiOf(tool)?.visibility, tool.name).toBeUndefined();
    }
  });

  it("leaves MCP Apps out for a client whose capabilities name none, and keeps them for one that does", async () => {
    const without = await overSession(base().options, false);
    const plain = (await without.listTools()).tools;
    expect(plain.filter((tool) => tool.name.startsWith("app_"))).toEqual([]);
    expect(uiOf(plain.find((tool) => tool.name === "artifact_open") ?? {})).toBeUndefined();
    // Left out before it ever listed tools: nothing changed for it, so nothing is announced.
    expect(sentBy.get(without)?.map((message) => message.method)).not.toContain(
      "notifications/tools/list_changed",
    );
    const withApps = await overSession(base().options, true);
    const full = (await withApps.listTools()).tools;
    expect(full.filter((tool) => tool.name.startsWith("app_"))).toHaveLength(11);
    expect(uiOf(full.find((tool) => tool.name === "artifact_open") ?? {})?.resourceUri).toBe(
      "ui://mostra/app",
    );
    // A server that offers no MCP Apps at all (a remote server's render: "link", D160).
    const off = await overHttp(
      base({ "artifact/list": () => ({ artifacts: [] }) }, { apps: false }).options,
    );
    const listed = (await off.listTools()).tools;
    expect(listed.filter((tool) => tool.name.startsWith("app_"))).toEqual([]);
    expect(uiOf(listed.find((tool) => tool.name === "artifact_open") ?? {})).toBeUndefined();
    expect((await off.listResources()).resources.map((resource) => resource.uri)).not.toContain(
      "ui://mostra/app",
    );
  });

  it("answers artifact_open with the link for the model and the page's handles", async () => {
    const { options } = base({
      "view/default": () => ({ url: LINK, tokenId: "tok_1", scopes: ["view", "draft", "submit"] }),
      "artifact/get": () => ({
        id: ARTIFACT,
        title: "Plan",
        versions: [
          { id: VERSION, number: 2 },
          { id: "ver_OLD", number: 1 },
        ],
      }),
    });
    const client = await overHttp(options);
    const result = await client.callTool({
      name: "artifact_open",
      arguments: { artifact: ARTIFACT },
    });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(JSON.parse(text).url).toBe(LINK);
    // The text's facts, for a client that reads only these, and the page's handles beside them.
    expect(result.structuredContent).toEqual({
      url: LINK,
      tokenId: "tok_1",
      scopes: ["view", "draft", "submit"],
      mostra: { artifactId: ARTIFACT, versionId: VERSION, version: 2, url: LINK },
    });
  });

  it("shows the version the link opens, the latest, after an earlier one was published again (R01 finding 1)", async () => {
    const { options } = base({
      "view/default": () => ({ url: LINK, tokenId: "tok_1", scopes: ["view"] }),
      "artifact/get": () => ({
        id: ARTIFACT,
        title: "Plan",
        // Version 1's source published again: the latest is 1, though 2 is the highest number.
        latestVersion: { id: "ver_OLD", number: 1 },
        versions: [
          { id: VERSION, number: 2 },
          { id: "ver_OLD", number: 1 },
        ],
      }),
    });
    const client = await overHttp(options);
    const result = await client.callTool({
      name: "artifact_open",
      arguments: { artifact: ARTIFACT },
    });
    expect((result.structuredContent as { mostra?: unknown }).mostra).toEqual({
      artifactId: ARTIFACT,
      versionId: "ver_OLD",
      version: 1,
      url: LINK,
    });
  });

  it("marks one person's own link so no page opens it inline as them (R02 finding 2)", async () => {
    const { options } = base({
      "view/url": () => ({ url: LINK, tokenId: "tok_2", scopes: ["view", "draft", "submit"] }),
      "artifact/get": () => ({
        id: ARTIFACT,
        title: "Plan",
        versions: [{ id: VERSION, number: 2 }],
      }),
    });
    const client = await overHttp(options);
    const result = await client.callTool({
      name: "artifact_open",
      arguments: { artifact: ARTIFACT, viewer: { ref: "alice", name: "Alice" } },
    });
    expect((result.structuredContent as { mostra?: { personal?: boolean } }).mostra?.personal).toBe(
      true,
    );
    // The model still gets the link to hand to Alice.
    expect(JSON.stringify(result.content)).toContain(LINK.slice(0, 20));
  });

  it("still answers the link when the version it opens can't be read", async () => {
    const { options } = base({
      "view/default": () => ({ url: LINK, tokenId: "tok_1", scopes: ["view"] }),
      "artifact/get": () => {
        throw new RpcError(createDiagnostic("MOSTRA_HOST_INTERNAL_ERROR", { message: "down" }));
      },
    });
    const client = await overHttp(options);
    const result = await client.callTool({
      name: "artifact_open",
      arguments: { artifact: ARTIFACT },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeUndefined();
    expect(JSON.stringify(result.content)).toContain("SECRETSECRETSECRETSECRET12");
  });

  it("serves the loader, one document with nothing to fetch, which parses as script", async () => {
    const client = await overHttp(base({ "artifact/list": () => ({ artifacts: [] }) }).options);
    const read = await client.readResource({ uri: "ui://mostra/app" });
    const content = read.contents[0] as {
      mimeType?: string;
      text?: string;
      _meta?: Record<string, unknown>;
    };
    expect(content.mimeType).toBe(MCP_APP_MIME_TYPE);
    // What a host frames every inline page with: a border asked for, and no outside origin, on
    // the listing and the content alike (D175 item 2; review findings Opus 7, Fable 5).
    expect(content._meta).toEqual({ ui: { prefersBorder: true } });
    const listed = (await client.listResources()).resources.find(
      (resource) => resource.uri === "ui://mostra/app",
    );
    expect(listed?._meta).toEqual({ ui: { prefersBorder: true } });
    const html = content.text ?? "";
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/\b(src|href)=["']?(https?:)?\/\//);
    // One inline script, whose text no casing of a closing tag can end early.
    expect(html.match(/<script\b/gi)).toHaveLength(1);
    const script = /<script>([\s\S]*)<\/script\s*>/i.exec(html)?.[1] ?? "";
    expect(script.length).toBeGreaterThan(0);
    expect(script.toLowerCase()).not.toContain("</script");
    // Run in a frame, it opens the MCP Apps handshake with the host, and only that.
    const sent: { method?: string; id?: unknown; params?: Record<string, unknown> }[] = [];
    const listeners: ((event: unknown) => void)[] = [];
    const parent = { postMessage: (message: never) => sent.push(message) };
    const element = { textContent: "", append: () => undefined };
    runInNewContext(script, {
      window: {
        parent,
        addEventListener: (_type: string, listener: (event: unknown) => void) =>
          listeners.push(listener),
        removeEventListener: () => undefined,
      },
      document: {
        getElementById: () => element,
        documentElement: { getBoundingClientRect: () => ({ height: 40 }), style: {} },
      },
      Map,
      Promise,
      Math,
    });
    expect(sent).toEqual([
      {
        jsonrpc: "2.0",
        id: "mostra-loader-1",
        method: "ui/initialize",
        params: {
          appInfo: { name: "mostra", version: "0.0.0-test" },
          appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] },
          protocolVersion: "2026-01-26",
        },
      },
    ]);
    expect(listeners).toHaveLength(1);
  });

  /** The loader's script run against a stand-in host: what it sends and says, and its timers. */
  async function loaderInVm() {
    const client = await overHttp(base().options);
    const read = await client.readResource({ uri: "ui://mostra/app" });
    const html = (read.contents[0] as { text?: string }).text ?? "";
    const script = /<script>([\s\S]*)<\/script\s*>/i.exec(html)?.[1] ?? "";
    const sent: { method?: string; id?: unknown; params?: Record<string, unknown> }[] = [];
    const listeners: ((event: unknown) => void)[] = [];
    const said: { textContent: string; tag: string }[] = [];
    const timers: { fn: () => void; ms: number }[] = [];
    const parent = { postMessage: (message: never) => sent.push(message) };
    const status = {
      set textContent(value: string) {
        if (value === "") said.length = 0;
      },
      append: (element: { textContent: string; tag: string }) => said.push(element),
    };
    runInNewContext(script, {
      window: {
        parent,
        addEventListener: (_type: string, listener: (event: unknown) => void) =>
          listeners.push(listener),
        removeEventListener: () => undefined,
      },
      document: {
        getElementById: () => status,
        createElement: (tag: string) => ({ tag, textContent: "", addEventListener: () => {} }),
        documentElement: { getBoundingClientRect: () => ({ height: 40 }), style: {} },
      },
      setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms }),
      Map,
      Promise,
      Math,
      Object,
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
    const deliver = async (data: unknown) => {
      for (const listener of listeners) listener({ source: parent, data, origin: "https://host" });
      await settle();
    };
    const initialize = (hostCapabilities: Record<string, unknown>) =>
      deliver({
        jsonrpc: "2.0",
        id: "mostra-loader-1",
        result: { hostCapabilities, hostContext: {} },
      });
    const result = (mostra: Record<string, unknown>) =>
      deliver({
        jsonrpc: "2.0",
        method: "ui/notifications/tool-result",
        params: { content: [], structuredContent: { mostra } },
      });
    return { sent, said, timers, initialize, result, settle };
  }

  const HANDLES = { artifactId: ARTIFACT, versionId: VERSION, version: 2, url: LINK };

  it("never reads or opens one person's own link, and offers no way into it (R02 finding 2)", async () => {
    const loader = await loaderInVm();
    await loader.initialize({ serverResources: {}, serverTools: {} });
    await loader.result({ ...HANDLES, personal: true });
    expect(loader.sent.some((message) => message.method === "resources/read")).toBe(false);
    expect(loader.said.map((element) => element.textContent)).toEqual([LOADER_WORDS.personal]);
  });

  it("reads the page where the host reads resources but runs no tools (R02 finding 8)", async () => {
    const loader = await loaderInVm();
    await loader.initialize({ serverResources: {} });
    await loader.result(HANDLES);
    const reads = loader.sent.filter((message) => message.method === "resources/read");
    expect(reads.map((message) => message.params)).toEqual([
      { uri: `ui://mostra/view/${VERSION}` },
    ]);
  });

  it("says the page couldn't open when no tool result comes (R02 finding 8)", async () => {
    const loader = await loaderInVm();
    await loader.initialize({ serverResources: {}, serverTools: {} });
    const wait = loader.timers.find((timer) => timer.ms === 30_000);
    expect(wait).toBeDefined();
    wait?.fn();
    await loader.settle();
    expect(loader.said.map((element) => element.textContent)).toEqual([LOADER_WORDS.failed]);
  });

  it("reads a version's page from the instance (app/page), and names a missing one", async () => {
    const { options, instance } = base({
      "app/page": (params) => {
        if (params["versionId"] !== VERSION) {
          throw new RpcError(
            createDiagnostic("MOSTRA_ARTIFACT_VERSION_NOT_FOUND", { message: "no" }),
          );
        }
        return {
          artifactId: ARTIFACT,
          uri: `ui://mostra/view/${VERSION}`,
          html: "<!doctype html><title>page</title>",
          meta: { csp: { connectDomains: ["https://api.example"] } },
        };
      },
    });
    const client = await overHttp(options);
    const read = await client.readResource({ uri: `ui://mostra/view/${VERSION}` });
    expect(read.contents[0]).toMatchObject({
      uri: `ui://mostra/view/${VERSION}`,
      mimeType: MCP_APP_MIME_TYPE,
      text: "<!doctype html><title>page</title>",
      _meta: { ui: { csp: { connectDomains: ["https://api.example"] } } },
    });
    expect(instance.calls).toEqual([{ method: "app/page", params: { versionId: VERSION } }]);
    await expect(
      client.readResource({ uri: "ui://mostra/view/ver_ABCDEFGHJKMNPQRSTVWXYZ0123" }),
    ).rejects.toThrow();
  });

  it("opens a view with the link's secret and runs each route over the app channel", async () => {
    const { options, instance } = base({
      "app/open": () => ({ session: "S".repeat(26), viewId: "vw_1" }),
      "app/request": (params) => ({ status: 200, body: { route: params["route"] } }),
    });
    const client = await overHttp(options);
    const open = await client.callTool({
      name: "app_open",
      arguments: { artifactId: ARTIFACT, url: LINK },
    });
    expect(open.structuredContent).toEqual({ session: "S".repeat(26), viewId: "vw_1" });
    const session = "S".repeat(26);
    const routes: [string, Record<string, unknown>, string][] = [
      ["app_fields", { body: { ops: [] } }, "fields"],
      ["app_submit", { body: {} }, "submit"],
      ["app_signal", { body: { name: "hi" } }, "signal"],
      ["app_call", { fnId: "actions.ts#send", body: {} }, "call"],
      ["app_run", { body: {} }, "runs"],
      ["app_run_status", { body: {} }, "runs/attach"],
      ["app_run_cancel", { runId: "run_1", body: {} }, "runs/cancel"],
      ["app_live", { body: { keys: [] } }, "live"],
      ["app_respondents", { body: {} }, "respondents"],
      ["app_events", { view: "vw_1", cursor: "12", wait: 25 }, "events/poll"],
    ];
    for (const [name, args, route] of routes) {
      const result = await client.callTool({
        name,
        arguments: { artifactId: ARTIFACT, session, revision: "2026-10-15", ...args },
      });
      expect(result.structuredContent, name).toEqual({ status: 200, body: { route } });
    }
    expect(instance.calls[0]).toEqual({
      method: "app/open",
      params: { artifactId: ARTIFACT, token: "SECRETSECRETSECRETSECRET12" },
    });
    expect(instance.calls[4]).toEqual({
      method: "app/request",
      params: {
        artifactId: ARTIFACT,
        session,
        revision: "2026-10-15",
        route: "call",
        fnId: "actions.ts#send",
        body: {},
      },
    });
    // A link without its secret opens nothing.
    const bare = await client.callTool({
      name: "app_open",
      arguments: { artifactId: ARTIFACT, url: `http://127.0.0.1:20001/a/${ARTIFACT}` },
    });
    expect(bare.isError).toBe(true);
    expect(JSON.stringify(bare.content)).toContain("MOSTRA_HYGIENE_TOKEN_INVALID");
  });
});
