/**
 * MCP Apps through a reference host (WP-17, MC-02, MC-03): an artifact opened with `artifact_open`
 * through the real `mostra mcp`, shown by ext-apps' AppBridge in a sandbox on another origin under
 * MCP Apps' default CSP, as a chat host shows it. Its fields, Submit and actions go through the
 * app-only tools; its look follows the host's variables; the full page is always offered; and
 * every feature a chat host's frame lacks says so in the page.
 */
import type { Client as McpClient } from "@modelcontextprotocol/client";
import { expect, type FrameLocator, type Page, test } from "@playwright/test";
import { publishOwn } from "../support/client.ts";
import { hostClient, type ReferenceHost, startReferenceHost } from "../support/mcp-apps-host.ts";
import { Client, readRun } from "../support/mostra.ts";

const run = readRun();
// Each test publishes its own version, whose MCP App is made on its first read (app/page): with a
// cold Firefox, a test that opens two pages took 25 s of its 30.
test.describe.configure({ timeout: 60_000 });
let host: ReferenceHost;
let mcp: McpClient;

test.beforeAll(async () => {
  host = await startReferenceHost();
  mcp = await hostClient(run.home);
});
test.afterAll(async () => {
  await mcp?.close();
  await host?.close();
});

/** The host's context: a few of MCP Apps' standard variables, as a host passes them. */
const HOST_CONTEXT = {
  theme: "dark",
  platform: "web",
  displayMode: "inline",
  styles: {
    variables: {
      "--color-background-primary": "rgb(10, 20, 30)",
      "--color-text-primary": "rgb(240, 241, 242)",
      "--font-sans": "Georgia, serif",
    },
  },
};

interface Opened {
  readonly toolResult: { structuredContent?: { mostra?: { url: string; versionId: string } } };
  readonly view: FrameLocator;
}

/** Calls artifact_open through the host's client and shows its result as the host would. */
async function openInline(
  page: Page,
  artifactId: string,
  options: { readonly refuseTools?: boolean } = {},
): Promise<Opened> {
  const { tools } = await mcp.listTools();
  const open = tools.find((tool) => tool.name === "artifact_open");
  const resourceUri = (open?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui
    ?.resourceUri;
  expect(resourceUri).toBe("ui://mostra/app");
  const toolInput = { artifact: artifactId };
  const toolResult = (await mcp.callTool({
    name: "artifact_open",
    arguments: toolInput,
  })) as Opened["toolResult"];
  const read = await mcp.readResource({ uri: resourceUri as string });
  const content = read.contents[0] as { text?: string; _meta?: { ui?: { csp?: unknown } } };
  await page.exposeFunction("mcpCallTool", (params: { name: string; arguments?: object }) =>
    mcp.callTool({ name: params.name, arguments: params.arguments as Record<string, unknown> }),
  );
  await page.exposeFunction("mcpReadResource", (params: { uri: string }) =>
    mcp.readResource({ uri: params.uri }),
  );
  await page.addInitScript(
    (setup) => {
      (window as unknown as { hostSetup: unknown }).hostSetup = setup;
    },
    {
      toolInput,
      toolResult,
      html: content.text ?? "",
      csp: content._meta?.ui?.csp,
      sandbox: host.sandbox,
      hostContext: HOST_CONTEXT,
      ...(options.refuseTools ? { refuseTools: true } : {}),
    },
  );
  await page.goto(host.url);
  return { toolResult, view: page.frameLocator("#sandbox").frameLocator("iframe") };
}

/** The inline bar the runtime renders below the page. */
const bar = (view: FrameLocator) => view.getByRole("region", { name: "Mostra" });

test.describe("an artifact inline in an MCP Apps host (MC-02)", () => {
  test("renders through the loader; fields, submit, calls and runs go through the app-only tools", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "inline" });
      const { view } = await openInline(page, own.artifactId);
      await expect(view.getByTestId("mode")).toHaveText("mcp-app");
      // The draft is saved through app_fields, Submit waits on the required answer.
      await expect(bar(view).getByText("1 answer needed")).toBeVisible();
      await view.getByTestId("name").fill("Ada");
      await view.getByTestId("name").blur();
      await expect(bar(view).getByText("Saved")).toBeVisible();
      // A plain call (app_call) and an action run (app_run, app_run_status).
      await view.getByTestId("call").click();
      await expect(view.getByTestId("called")).toHaveText("Hello, Ada");
      await view.getByTestId("run").click();
      await expect(view.getByTestId("ran")).toHaveText("Hello, Ada");
      // Submit, through the artifact channel (app_submit).
      await bar(view).getByRole("button", { name: "Submit" }).click();
      await expect(bar(view).getByText("Submitted")).toBeVisible();
      const results = await mcp.callTool({
        name: "artifact_results",
        arguments: { artifact: own.artifactId, format: "json" },
      });
      const parsed = JSON.parse(
        (results.content as { type: string; text: string }[])[0]?.text ?? "{}",
      ) as { answers: Record<string, unknown>; submission: { channel: string } };
      expect(parsed.answers).toEqual({ name: "Ada" });
      expect(parsed.submission.channel).toBe("artifact");
    } finally {
      client.close();
    }
  });

  test("declares its CSP, takes the host's look, and always offers the full page", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "inline" });
      const { view, toolResult } = await openInline(page, own.artifactId);
      const handles = toolResult.structuredContent?.mostra;
      // The version's own page declares the origins its source names (D175 item 2).
      const page2 = await mcp.readResource({ uri: `ui://mostra/view/${handles?.versionId}` });
      const declared = page2.contents[0] as {
        mimeType?: string;
        text?: string;
        _meta?: { ui?: { csp?: { resourceDomains?: string[] } } };
      };
      expect(declared.mimeType).toBe("text/html;profile=mcp-app");
      expect(declared._meta?.ui?.csp?.resourceDomains).toContain("https://images.example.com");
      expect(declared.text).toContain('<meta name="mostra-target" content="mcp-app" />');
      // Mostra's tokens read the host's variables; its theme sets light or dark (D175 item 6).
      await expect(view.getByTestId("mode")).toHaveText("mcp-app");
      const look = await view.locator("html").evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          background: style.getPropertyValue("--background").trim(),
          foreground: style.getPropertyValue("--foreground").trim(),
          appearance: element.getAttribute("data-appearance"),
        };
      });
      expect(look).toEqual({
        background: "rgb(10, 20, 30)",
        foreground: "rgb(240, 241, 242)",
        appearance: "dark",
      });
      // The full page, through the host's ui/open-link.
      await bar(view).getByRole("button", { name: "Open the full page" }).click();
      await expect
        .poll(() =>
          page.evaluate(
            () => (window as unknown as { hostLog: { openedLinks: string[] } }).hostLog.openedLinks,
          ),
        )
        .toEqual([handles?.url]);
      // The frame takes the page's height.
      const heights = await page.evaluate(
        () => (window as unknown as { hostLog: { heights: number[] } }).hostLog.heights,
      );
      expect(heights.length).toBeGreaterThan(0);
    } finally {
      client.close();
    }
  });

  test("saves what was typed before the host removes the page", async ({ page }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "inline" });
      const { view } = await openInline(page, own.artifactId);
      await view.getByTestId("name").fill("Grace");
      // No blur: only the teardown's save can carry it (ui/resource-teardown).
      await page.evaluate(() =>
        (
          window as unknown as { hostBridge: { teardownResource(p: object): Promise<unknown> } }
        ).hostBridge.teardownResource({}),
      );
      const again = await page.context().newPage();
      const reopened = await openInline(again, own.artifactId);
      await expect(reopened.view.getByTestId("name")).toHaveValue("Grace");
      await again.close();
    } finally {
      client.close();
    }
  });
});

test.describe("what a chat host's frame lacks says so (MC-03)", () => {
  test("presence and a blocked origin each state their message", async ({ page }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "inline" });
      const { view } = await openInline(page, own.artifactId);
      await expect(view.getByTestId("presence")).toHaveText("unavailable");
      await expect(bar(view).getByText("Who else is here shows on the full page.")).toBeVisible();
      await expect(
        bar(view).getByText(/This chat app blocks https:\/\/images\.example\.com/),
      ).toBeVisible();
    } finally {
      client.close();
    }
  });

  test("a host without the app-only tools keeps answers in the browser, and says so", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "inline" });
      const { view } = await openInline(page, own.artifactId, { refuseTools: true });
      await expect(
        bar(view).getByText(/This chat app can't save answers here: they stay in this browser/),
      ).toBeVisible();
      await expect(bar(view).getByRole("button", { name: "Open the full page" })).toBeVisible();
      await expect(bar(view).getByRole("button", { name: "Submit" })).toBeHidden();
    } finally {
      client.close();
    }
  });
});
