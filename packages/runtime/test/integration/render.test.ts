/// <reference lib="dom" />
/**
 * Built versions render in a real browser (AU-01, AU-02): plain React, MDX and a directory with
 * pages, components, data, assets and Tailwind, each published through a real daemon and opened
 * from its version directory in Chromium. Serving through the gateway is WP-05's; this test uses a
 * plain static server with the SPA fallback the gateway also applies.
 */
import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectTo,
  type DaemonStatus,
  initializeParams,
  type LineClient,
  type Message,
  type RuntimeProcess,
  startDaemon,
  type TestHome,
  tempDir,
  testHome,
} from "../support.ts";

const FIXTURES = fileURLToPath(new URL("../fixtures/artifacts/", import.meta.url));
const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
};

let home: TestHome;
let daemon: RuntimeProcess & { status: DaemonStatus };
let client: LineClient;
let browser: Browser;
const servers: Server[] = [];

const result = (message: Message): unknown => {
  if (message.error) throw new Error(`${message.error.data.code}: ${message.error.data.message}`);
  return message.result;
};

/** Publishes a fixture copy and serves its version's client build on a loopback port. */
async function publishAndServe(fixture: string, entry = ""): Promise<string> {
  const dir = join(tempDir(`render-${fixture}`), fixture);
  cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  const receipt = result(
    await client.call("artifact/publish", { source: { path: entry ? join(dir, entry) : dir } }),
  ) as { versionId: string };
  const root = join(home.home, "versions", receipt.versionId, "client");
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname));
    let file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
      file = join(root, "index.html"); // The SPA fallback: every route is the page.
    }
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    response.end(readFileSync(file));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return `http://127.0.0.1:${address.port}`;
}

/** Opens a page and collects its errors. */
async function open(url: string): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(url);
  return { page, errors };
}

beforeAll(async () => {
  home = testHome();
  daemon = await startDaemon(home);
  client = await connectTo(daemon.status.socket as string);
  result(await client.call("mostra/initialize", initializeParams()));
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  for (const server of servers) server.close();
  await client.call("mostra/shutdown", {});
  await daemon.exited;
});

describe("versions render in Chromium (AU-01, AU-02)", () => {
  it("renders a single plain React page, styled by Tailwind, with working state", async () => {
    const { page, errors } = await open(await publishAndServe("single-tsx", "page.tsx"));
    const heading = page.getByRole("heading", { name: "Sidebar density" });
    await heading.waitFor();
    expect(await heading.evaluate((node) => getComputedStyle(node).fontWeight)).toBe("600");
    expect(await heading.evaluate((node) => getComputedStyle(node).color)).not.toBe("rgb(0, 0, 0)");
    await page.getByRole("button", { name: "Spacious" }).click();
    expect(await page.getByTestId("chosen").textContent()).toBe("Chosen: Spacious");
    expect(errors).toEqual([]);
  });

  it("renders a single MDX page with GitHub tables and its own components", async () => {
    const { page, errors } = await open(await publishAndServe("single-mdx", "page.mdx"));
    await page.getByRole("heading", { name: "Release notes 2.4" }).waitFor();
    expect(await page.locator("table tbody tr").count()).toBe(2);
    expect(await page.getByTestId("count").textContent()).toBe("2 changes");
    expect(await page.title()).toBe("Release notes review");
    // The frontmatter is the manifest, never page content.
    expect(await page.content()).not.toContain("family: review");
    expect(errors).toEqual([]);
  });

  it("renders a directory artifact's pages inside its layout, with components, data and assets", async () => {
    const base = await publishAndServe("directory");
    const { page, errors } = await open(base);
    await page.getByTestId("greeting").waitFor();
    expect(await page.getByTestId("layout").textContent()).toBe("Team dashboard");
    expect(await page.getByTestId("greeting").textContent()).toBe("Hello, team");
    expect(await page.getByTestId("item").allTextContents()).toEqual([
      "Ship the release notes",
      "Review the dashboard",
    ]);
    expect(
      await page.getByTestId("logo").evaluate((image) => (image as HTMLImageElement).naturalWidth),
    ).toBe(16);
    expect(
      await page.locator(".dashboard").evaluate((node) => getComputedStyle(node).fontFamily),
    ).toContain("system-ui");

    await page.goto(`${base}/settings`);
    expect(await page.getByTestId("settings").textContent()).toBe("Settings");
    expect(await page.getByTestId("layout").textContent()).toBe("Team dashboard");
    await page.goto(`${base}/reports/42`);
    expect(await page.getByTestId("report").textContent()).toBe("Report 42");
    expect(errors).toEqual([]);
  });

  it("gives a server function's client stub its ID, and fails it loudly where no server runs (D54)", async () => {
    const { page } = await open(await publishAndServe("directory"));
    await page.getByTestId("greeting").waitFor();
    // The fixture calls the action without awaiting it, so its rejection surfaces as a page error.
    const rejection = page.waitForEvent("pageerror");
    await page.getByRole("button", { name: "Archive" }).click();
    expect((await rejection).message).toContain(
      "server function actions.ts#archive can't run here",
    );
  });
});
