/// <reference lib="dom" />
/**
 * `pages/` routing per delivery target, in Chromium, Firefox and WebKit (AU-09, D57, D111): behind
 * the gateway the frame navigates in browser history, deep links open their page, and every page
 * is reported to the shell (comments record it, WP-20); the same build marked as a static export
 * routes by hash, and as an MCP App routes in memory. The static check serves a real published
 * export the real static exporter writes (WP-24, D185), served as a static host serves it and
 * opened from disk; the MCP App check serves the real MCP App exporter's output (WP-17).
 */
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, extname, join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { gotoShell, linkFor, openInShell, publishOwn, viewerName } from "../support/client.ts";
import { Client, readRun } from "../support/mostra.ts";
import { listenShortLived } from "../support/ports.ts";

const run = readRun();

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".map": "application/json",
};

/**
 * Serves a folder as a static host does: the file at the path, `index.html` at `/`, nothing else.
 * No SPA fallback: a static host has none.
 */
async function serveFolder(
  folder: string,
): Promise<{ readonly url: string; readonly server: Server }> {
  const server = createServer((request, response) => {
    // URL paths are `/`-separated on every platform (`normalize` would make them `\` on Windows).
    const path = posix.normalize(
      decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname),
    );
    const file = path === "/" ? "/index.html" : path;
    try {
      const body = readFileSync(join(folder, file));
      response.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await listenShortLived(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  return { url: `http://127.0.0.1:${address.port}/`, server };
}

/** Serves one file at `/`, as a host serves an MCP App's single document. */
async function serveFile(file: string): Promise<{ readonly url: string; readonly server: Server }> {
  const server = createServer((request, response) => {
    if (new URL(request.url ?? "/", "http://x").pathname !== "/") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no address");
  return { url: `http://127.0.0.1:${address.port}/`, server };
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

  test("as a static export: hash routing, on a host with no fallback and from disk", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    const own = await publishOwn(client, run.home, info, { fixture: "pages" });
    // The real exporter's output (WP-24, D185 item 7): its `index.html` marked `static`.
    const out = join(
      dirname(run.home),
      "exports",
      `pages-static-${info.project.name}-${Date.now()}`,
    );
    await client.call("artifact/export", {
      artifact: { artifactId: own.artifactId },
      as: "static",
      out,
    });
    expect(readFileSync(join(out, "index.html"), "utf8")).toContain(
      '<meta name="mostra-target" content="static" />',
    );
    const served = await serveFolder(out);
    try {
      await gotoShell(page, served.url);
      await expect(page.getByTestId("page")).toHaveText("Home");
      await expect(page.getByTestId("mode")).toHaveText("static");
      await page.getByTestId("to-settings").click();
      await expect(page.getByTestId("page")).toHaveText("Settings");
      expect(new URL(page.url()).hash).toBe("#/settings");
      expect(new URL(page.url()).pathname).toBe("/");
      // The hash is a deep link a static host can serve.
      await gotoShell(page, `${served.url}#/reports/9`);
      await expect(page.getByTestId("page")).toHaveText("Report 9");
      // Fields keep local state where there is no Mostra server (INTERFACES §2.3).
      await gotoShell(page, `${served.url}#/settings`);
      await page.getByTestId("theme").fill("dark");
      await page.reload();
      await expect(page.getByTestId("theme")).toHaveValue("dark");
      // The same export opened from disk routes by hash too.
      await gotoShell(page, `${pathToFileURL(join(out, "index.html")).href}#/reports/4`);
      await expect(page.getByTestId("page")).toHaveText("Report 4");
      await page.getByTestId("to-settings").click();
      await expect(page.getByTestId("page")).toHaveText("Settings");
    } finally {
      served.server.close();
      client.close();
    }
  });

  test("as an MCP App: memory routing, the frame's URL never changes", async ({ page }, info) => {
    const client = await Client.connect(run.socket);
    const own = await publishOwn(client, run.home, info, { fixture: "pages" });
    // The real exporter's output (WP-17, D175 item 2): one document, its routes inside it.
    const out = join(dirname(run.home), "exports", `pages-${info.project.name}-${Date.now()}`);
    const exported = await client.call<{ entry?: string }>("plugin/export", {
      artifact: { artifactId: own.artifactId },
      exporter: "mcp-app",
      out,
    });
    expect(exported.entry).toBe(join(out, "index.html"));
    const served = await serveFile(join(out, "index.html"));
    try {
      await gotoShell(page, served.url);
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
