/**
 * MCP Apps through a reference host (WP-17, MC-02, MC-03): an artifact opened with `artifact_open`
 * through the real `mostra mcp`, shown by ext-apps' AppBridge in a sandbox on another origin under
 * MCP Apps' default CSP, as a chat host shows it. Its fields, Submit and actions go through the
 * app-only tools; its look follows the host's variables; the full page is always offered; and
 * every feature a chat host's frame lacks says so in the page.
 */
import type { Client as McpClient } from "@modelcontextprotocol/client";
import { expect, type FrameLocator, type Page, test } from "@playwright/test";
import { publishOwn, republish } from "../support/client.ts";
import { hostClient, type ReferenceHost, startReferenceHost } from "../support/mcp-apps-host.ts";
import { Client, readRun, removeTree, startDaemon } from "../support/mostra.ts";

const run = readRun();
// Each test publishes its own version, whose MCP App is made on its first read (app/page): with a
// cold Firefox, a test that opens two pages took 25 s of its 30.
test.describe.configure({ timeout: 60_000 });
let host: ReferenceHost;
let sharedMcp: McpClient;

test.beforeAll(async () => {
  host = await startReferenceHost();
  sharedMcp = await hostClient(run.home);
});
test.afterAll(async () => {
  await sharedMcp?.close();
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
  /** Every tool call the page made through the host, in order. */
  readonly calls: { readonly name: string; readonly arguments?: Record<string, unknown> }[];
}

/** Calls artifact_open through the host's client and shows its result as the host would. */
async function openInline(
  page: Page,
  artifactId: string,
  options: {
    readonly refuseTools?: boolean;
    readonly refuseFields?: boolean;
    readonly slowCalls?: boolean;
    readonly refuseSubmit?: boolean;
    /** The link's scopes: a link of its own, through artifact_open's `scopes`. */
    readonly scopes?: readonly string[];
    readonly mcp?: McpClient;
  } = {},
): Promise<Opened> {
  const mcp = options.mcp ?? sharedMcp;
  const { tools } = await mcp.listTools();
  const open = tools.find((tool) => tool.name === "artifact_open");
  const resourceUri = (open?._meta as { ui?: { resourceUri?: string } } | undefined)?.ui
    ?.resourceUri;
  expect(resourceUri).toBe("ui://mostra/app");
  const toolInput = {
    artifact: artifactId,
    ...(options.scopes !== undefined ? { scopes: [...options.scopes] } : {}),
  };
  const toolResult = (await mcp.callTool({
    name: "artifact_open",
    arguments: toolInput,
  })) as Opened["toolResult"];
  const read = await mcp.readResource({ uri: resourceUri as string });
  const content = read.contents[0] as { text?: string; _meta?: { ui?: { csp?: unknown } } };
  const calls: Opened["calls"] = [];
  await page.exposeFunction(
    "mcpCallTool",
    async (params: { name: string; arguments?: Record<string, unknown> }) => {
      const result = await mcp.callTool({ name: params.name, arguments: params.arguments ?? {} });
      // Recorded once answered, so a call listed before an event happened ended before it.
      calls.push({
        name: params.name,
        ...(params.arguments ? { arguments: params.arguments } : {}),
      });
      return result;
    },
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
      ...(options.refuseFields ? { refuseFields: true } : {}),
      ...(options.slowCalls ? { slowCalls: true } : {}),
      ...(options.refuseSubmit ? { refuseSubmit: true } : {}),
    },
  );
  await page.goto(host.url);
  return { toolResult, view: page.frameLocator("#sandbox").frameLocator("iframe"), calls };
}

/** The inline bar the runtime renders below the page. */
const bar = (view: FrameLocator) => view.getByRole("region", { name: "Mostra" });

test.describe("an artifact inline in an MCP Apps host (MC-02)", () => {
  test("keeps each artifact's unsent answers its own, though a host gives every page one origin (D175 item 6)", async ({
    page,
  }, info) => {
    // Three pages inline, one after another.
    test.setTimeout(120_000);
    const client = await Client.connect(run.socket);
    try {
      const first = await publishOwn(client, run.home, info, { fixture: "inline" });
      const second = await publishOwn(client, run.home, info, { fixture: "inline" });
      // The first page's save never reaches the server: its answer waits in the journal.
      const a = await openInline(page, first.artifactId, { refuseFields: true });
      // Each page's first showing, given room on a loaded machine.
      const shown = { timeout: 30_000 };
      await expect(a.view.getByTestId("mode")).toHaveText("mcp-app", shown);
      await a.view.getByTestId("name").fill("Only the first's");
      await a.view.getByTestId("name").blur();
      await expect(bar(a.view).getByText("Not saved yet")).toBeVisible();
      await page.close();
      // Another artifact's page, in the same sandbox origin, once the first's tab is gone: it
      // adopts what gone tabs left in its journal, and nothing of the first artifact's.
      const b = await openInline(await page.context().newPage(), second.artifactId);
      // Its required name is still missing: had it adopted the first's answer, nothing would be.
      await expect(bar(b.view).getByText("1 answer needed")).toBeVisible(shown);
      await expect.poll(() => b.calls.some((call) => call.name === "app_events"), shown).toBe(true);
      await expect(b.view.getByTestId("name")).toHaveValue("");
      expect(JSON.stringify(b.calls)).not.toContain("Only the first's");
      // The first artifact's own page, opened again, finds its answer and sends it.
      const again = await openInline(await page.context().newPage(), first.artifactId);
      await expect(again.view.getByTestId("name")).toHaveValue("Only the first's", shown);
      await expect
        .poll(
          () =>
            again.calls.some(
              (call) =>
                call.name === "app_fields" &&
                JSON.stringify(call.arguments).includes("Only the first's"),
            ),
          shown,
        )
        .toBe(true);
    } finally {
      client.close();
    }
  });

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
      const results = await sharedMcp.callTool({
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
      const page2 = await sharedMcp.readResource({ uri: `ui://mostra/view/${handles?.versionId}` });
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
      const { view, calls } = await openInline(page, own.artifactId);
      await expect(bar(view).getByText("1 answer needed")).toBeVisible();
      await view.getByTestId("name").fill("Grace");
      // No blur, and sooner than the field's debounced save (about 400 ms): only the teardown's
      // save can have carried it by the time the page answers the host (ui/resource-teardown).
      await page.evaluate(() =>
        (
          window as unknown as { hostBridge: { teardownResource(p: object): Promise<unknown> } }
        ).hostBridge.teardownResource({}),
      );
      const saved = calls.filter((call) => call.name === "app_fields");
      expect(JSON.stringify(saved.at(-1)?.arguments)).toContain('"Grace"');
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
  test("presence, review, frames, outside origins, streamed results and a newer version each state their message", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "inline" });
      const { view } = await openInline(page, own.artifactId);
      await expect(view.getByTestId("mode")).toHaveText("mcp-app");
      // Presence needs ten updates a second, which a host's tool calls don't carry.
      await expect(view.getByTestId("presence")).toHaveText("unavailable");
      await expect(bar(view).getByText("Who else is here shows on the full page.")).toBeVisible();
      // The shell's review overlay isn't here.
      await expect(bar(view).getByText("Comments are made on the full page.")).toBeVisible();
      // The host's policy blocks the nested frame and the outside image, each named.
      await expect(bar(view).getByText("Embedded views show on the full page.")).toBeVisible();
      await expect(
        bar(view).getByText(/This chat app blocks https:\/\/images\.example\.com/),
      ).toBeVisible();
      // A stream's batches arrive with its end.
      await view.getByTestId("count").click();
      await expect(view.getByTestId("counted")).toHaveText("1,2,3");
      await expect(bar(view).getByText("Results here arrive all at once.")).toBeVisible();
      // A version published since: only the full page's banner offers it.
      await republish(client, own, (text) => text.replace("Inline fixture", "Inline fixture 2"));
      await expect(bar(view).getByText("A newer version is on the full page.")).toBeVisible({
        timeout: 40_000,
      });
      // Choose stays the page's own channel here, offered in the bar.
      await bar(view).getByRole("button", { name: "Choose Dense" }).click();
      await expect(view.getByTestId("choice")).toHaveText("dense");
    } finally {
      client.close();
    }
  });

  test("where only the shell's trusted controls may submit or choose, the page says to use the full page", async ({
    page,
  }, info) => {
    // A home of this test's own: its channel setting applies to every artifact in it.
    const daemon = await startDaemon();
    const own = await Client.connect(daemon.socket, {
      name: "shell-only-host",
      home: { submitChannels: ["shell"] },
    });
    const ownMcp = await hostClient(daemon.home);
    try {
      const published = await publishOwn(own, daemon.home, info, { fixture: "inline" });
      const { view } = await openInline(page, published.artifactId, { mcp: ownMcp });
      await expect(view.getByTestId("mode")).toHaveText("mcp-app");
      await expect(bar(view).getByText("Submit from the full page.")).toBeVisible();
      await expect(bar(view).getByText("Choosing is done on the full page.")).toBeVisible();
      await expect(bar(view).getByRole("button", { name: "Submit" })).toBeHidden();
      await expect(bar(view).getByRole("button", { name: /^Choose / })).toBeHidden();
      await expect(bar(view).getByRole("button", { name: "Open the full page" })).toBeVisible();
    } finally {
      await ownMcp.close();
      own.close();
      daemon.child.kill("SIGTERM");
      await new Promise((resolve) => daemon.child.once("exit", resolve));
      removeTree(daemon.root);
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

  test("a call past the chat host's bound says why it stopped (Fable 6)", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "inline" });
      const { view } = await openInline(page, own.artifactId, { slowCalls: true });
      await view.getByTestId("call").click();
      await expect(
        bar(view).getByText("A step that took longer than 45 seconds stopped here."),
      ).toBeVisible();
    } finally {
      client.close();
    }
  });

  test("a Submit the server refuses says why, in its own words (Fable 14)", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "inline" });
      const { view } = await openInline(page, own.artifactId, { refuseSubmit: true });
      await view.getByTestId("name").fill("Ada");
      await view.getByTestId("name").blur();
      await expect(bar(view).getByText("Saved")).toBeVisible();
      await bar(view).getByRole("button", { name: "Submit" }).click();
      await expect(
        bar(view).getByText("This page is taking many answers; try again shortly."),
      ).toBeVisible();
      await expect(bar(view).getByRole("button", { name: "Submit" })).toBeEnabled();
    } finally {
      client.close();
    }
  });

  test("a link without the review scope gets no Choose, and says where it's done (Fable 15)", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "inline" });
      const { view } = await openInline(page, own.artifactId, {
        scopes: ["view", "draft", "submit", "action:*"],
      });
      await expect(bar(view).getByText("Choosing is done on the full page.")).toBeVisible();
      await expect(bar(view).getByRole("button", { name: /^Choose / })).toBeHidden();
    } finally {
      client.close();
    }
  });
});
