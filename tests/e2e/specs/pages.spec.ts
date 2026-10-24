/// <reference lib="dom" />
/**
 * `pages/` routing per delivery target, in Chromium, Firefox and WebKit (AU-09, D57, D111): behind
 * the gateway the frame navigates in browser history, deep links open their page, and every page
 * is reported to the shell (comments record it, WP-20); the same build marked as a static export
 * routes by hash, and marked as an MCP App routes in memory. The static and MCP App checks serve
 * a real published build with the `mostra-target` marker the exporters write (WP-13, WP-17 repeat
 * them through the real exporters).
 */
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, posix } from "node:path";
import { expect, test } from "@playwright/test";
import { linkFor, openInShell, publishOwn, viewerName } from "../support/client.ts";
import { Client, readRun } from "../support/mostra.ts";

const run = readRun();

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

/**
 * Serves a version's client build as a static host would, with its `index.html` marked for a
 * delivery target (D111), as the exporters write it. No SPA fallback: a static host has none.
 */
async function serveExport(
  clientDir: string,
  target: "static" | "mcp-app",
): Promise<{ readonly url: string; readonly server: Server }> {
  const server = createServer((request, response) => {
    // URL paths are `/`-separated on every platform (`normalize` would make them `\` on Windows).
    const path = posix.normalize(
      decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname),
    );
    const file = path === "/" ? "/index.html" : path;
    try {
      let body: Buffer | string = readFileSync(join(clientDir, file));
      if (file === "/index.html") {
        body = body
          .toString("utf8")
          .replace("<head>", `<head>\n    <meta name="mostra-target" content="${target}" />`);
      }
      response.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  return { url: `http://127.0.0.1:${address.port}/`, server };
}

/** The client build of an artifact's latest version, in the run's home. */
async function clientDirOf(client: Client, artifactId: string): Promise<string> {
  const detail = await client.call<{ versions: { id: string }[] }>("artifact/get", {
    artifact: { artifactId },
  });
  const latest = detail.versions[0];
  if (!latest) throw new Error("no version");
  return join(run.home, "versions", latest.id, "client");
}

test.describe("pages/ in each delivery target (AU-09)", () => {
  test("behind the gateway: browser history, deep links, and the page reported to the shell", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "pages" });
      const frame = await openInShell(
        page,
        await linkFor(client, own.artifactId, viewerName(info)),
      );
      const artifact = page.frames().find((candidate) => candidate !== page.mainFrame());
      await expect(frame.getByTestId("page")).toHaveText("Home");
      await expect(frame.getByTestId("mode")).toHaveText("live");
      await expect(page.locator("html")).toHaveAttribute("data-shell-page", "/");
      await frame.getByTestId("to-settings").click();
      await expect(frame.getByTestId("page")).toHaveText("Settings");
      expect(new URL(artifact?.url() ?? "").pathname).toBe("/settings");
      await expect(page.locator("html")).toHaveAttribute("data-shell-page", "/settings");
      await frame.getByTestId("to-report").click();
      await expect(frame.getByTestId("page")).toHaveText("Report 42");
      await expect(page.locator("html")).toHaveAttribute("data-shell-page", "/reports/42");
      // Back goes through the frame's own history.
      await artifact?.evaluate(() => history.back());
      await expect(frame.getByTestId("page")).toHaveText("Settings");
      await expect(page.locator("html")).toHaveAttribute("data-shell-page", "/settings");
      // A field on a page saves like any other.
      await frame.getByTestId("theme").fill("dark");
      await expect(page.locator("[data-mostra-save]")).toHaveAttribute("data-mostra-save", "saved");
      // A deep link inside the frame opens its page (the gateway serves index.html, D57).
      await artifact?.evaluate(() => location.assign("/reports/7"));
      await expect(frame.getByTestId("page")).toHaveText("Report 7", { timeout: 15_000 });
      await expect(page.locator("html")).toHaveAttribute("data-shell-page", "/reports/7");
      // The shell itself never navigated.
      expect(new URL(page.url()).pathname).toBe(`/a/${own.artifactId}`);
    } finally {
      client.close();
    }
  });

  test("as a static export: hash routing, on a host with no fallback", async ({ page }, info) => {
    const client = await Client.connect(run.socket);
    const own = await publishOwn(client, run.home, info, { fixture: "pages" });
    const served = await serveExport(await clientDirOf(client, own.artifactId), "static");
    try {
      await page.goto(served.url);
      await expect(page.getByTestId("page")).toHaveText("Home");
      await expect(page.getByTestId("mode")).toHaveText("static");
      await page.getByTestId("to-settings").click();
      await expect(page.getByTestId("page")).toHaveText("Settings");
      expect(new URL(page.url()).hash).toBe("#/settings");
      expect(new URL(page.url()).pathname).toBe("/");
      // The hash is a deep link a static host can serve.
      await page.goto(`${served.url}#/reports/9`);
      await expect(page.getByTestId("page")).toHaveText("Report 9");
      // Fields keep local state where there is no Mostra server (INTERFACES §2.3).
      await page.goto(`${served.url}#/settings`);
      await page.getByTestId("theme").fill("dark");
      await page.reload();
      await expect(page.getByTestId("theme")).toHaveValue("dark");
    } finally {
      served.server.close();
      client.close();
    }
  });

  test("as an MCP App: memory routing, the frame's URL never changes", async ({ page }, info) => {
    const client = await Client.connect(run.socket);
    const own = await publishOwn(client, run.home, info, { fixture: "pages" });
    const served = await serveExport(await clientDirOf(client, own.artifactId), "mcp-app");
    try {
      await page.goto(served.url);
      await expect(page.getByTestId("page")).toHaveText("Home");
      await expect(page.getByTestId("mode")).toHaveText("mcp-app");
      const before = page.url();
      await page.getByTestId("to-settings").click();
      await expect(page.getByTestId("page")).toHaveText("Settings");
      await page.getByTestId("to-report").click();
      await expect(page.getByTestId("page")).toHaveText("Report 42");
      await expect(page.getByTestId("path")).toHaveText("/reports/42");
      expect(page.url()).toBe(before);
    } finally {
      served.server.close();
      client.close();
    }
  });
});
