/// <reference lib="dom" />
/**
 * Web demos and exports (TM-08, VR-07; D185) in Chromium, Firefox and WebKit through the real
 * gateway, shell and daemon. A Vite app and a Next.js static export, each with client-side routing
 * and data it ships, build through their demo spec into the version and are fully interactive in
 * `<WebDemo>`: they move between pages, a deep link opens its page, a comment inside one is
 * anchored there and survives a reload, and both work through a share (a host's external base on
 * another site, so worker-mode frames). Every export class opens the page and its demos from disk;
 * a history-routed demo says in its frame why moving between pages there needs a web server; a
 * hash-routed one moves anyway; and `static --base /sub/` serves a history-routed demo fully from
 * `/sub/`.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import {
  expect,
  type FrameLocator,
  type Locator,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";
import { E2E_FIXTURES, gotoShell, linkFor, openInShell, viewerName } from "../support/client.ts";
import { Client, readRun, removeTree, startDaemon } from "../support/mostra.ts";
import { listenShortLived } from "../support/ports.ts";

const run = readRun();

/**
 * The tools the fixture's demos build with, the suite's own (`npx --no vite`, `npx --no next`):
 * resolved here, so a checkout without them says so before a build fails on it.
 */
const require = createRequire(import.meta.url);
const BUILDERS = [require.resolve("vite/package.json"), require.resolve("next/package.json")];

/**
 * Where a test copies the fixture: inside the suite's own folder, so a demo's build resolves the
 * suite's Vite and Next.js the way a project's build resolves its own dependencies.
 */
const WORK = join(dirname(E2E_FIXTURES), ".work");

let copies = 0;

/** Copies the demos fixture to a folder of the test's own and publishes it. */
async function publishDemos(client: Client, info: TestInfo): Promise<string> {
  expect(BUILDERS).toHaveLength(2);
  const dir = join(WORK, `demos-${info.project.name}-${process.pid}-${Date.now()}-${copies++}`);
  mkdirSync(WORK, { recursive: true });
  cpSync(join(E2E_FIXTURES, "demos"), dir, { recursive: true });
  const receipt = await client.call<{ artifactId: string }>("artifact/publish", {
    source: { path: dir },
  });
  return receipt.artifactId;
}

/** A demo's own frame inside the artifact's. */
const demo = (frame: FrameLocator | Page, name: string): FrameLocator =>
  frame.frameLocator(`iframe[data-mostra-demo="${name}"]`);

/** Moves through a history-routed demo's pages and back, its counter clicked on the way. */
async function moveThrough(app: FrameLocator): Promise<void> {
  await expect(app.locator("#title")).toHaveText("Inventory", { timeout: 30_000 });
  await app.locator("#count").click();
  await expect(app.locator("#count")).toHaveText("Clicked 1");
  await app.locator("#item-2").click();
  await expect(app.locator("#title")).toHaveText("Linen lamp");
  await app.locator("#back").click();
  await expect(app.locator("#title")).toHaveText("Inventory");
}

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".txt": "text/plain",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

/**
 * Serves a folder as a plain static host does: the file at the path, a folder's `index.html`,
 * nothing else; no fallback. `under` mounts it at a subpath (`/sub/`).
 */
async function serveFolder(
  folder: string,
  under = "/",
): Promise<{ readonly url: string; readonly server: Server }> {
  const server = createServer((request, response) => {
    const path = posix.normalize(
      decodeURIComponent(new URL(request.url ?? "/", "http://x").pathname),
    );
    if (!path.startsWith(under)) {
      response.writeHead(404).end();
      return;
    }
    let file = join(folder, ...path.slice(under.length).split("/").filter(Boolean));
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    try {
      const body = readFileSync(file);
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
  return { url: `http://127.0.0.1:${address.port}${under}`, server };
}

/** Exports the artifact's latest version; resolves with where it went and the result. */
async function exportAs(
  client: Client,
  artifactId: string,
  as: "static" | "html" | "snapshot",
  info: TestInfo,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<{ readonly out: string; readonly result: Record<string, unknown> }> {
  const out = join(
    dirname(run.home),
    "exports",
    `${as}-${info.project.name}-${Date.now()}-${copies++}${as === "html" ? ".html" : ""}`,
  );
  const result = await client.call<Record<string, unknown>>("artifact/export", {
    artifact: { artifactId },
    as,
    out,
    ...extra,
  });
  return { out, result };
}

test.describe("web demos built into the version (TM-08)", () => {
  test("a Vite and a Next.js demo are fully interactive, move between pages, and open from a deep link", async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    const client = await Client.connect(run.socket);
    try {
      const artifactId = await publishDemos(client, info);
      await page.setViewportSize({ width: 1280, height: 900 });
      const frame = await openInShell(page, await linkFor(client, artifactId, viewerName(info)));
      for (const name of ["vite", "next"]) {
        const app = demo(frame, name);
        await moveThrough(app);
        // A deep link: the demo's frame loaded afresh at one of its pages.
        await app.locator("#item-3").click();
        await expect(app.locator("#title")).toHaveText("Oak shelf");
        await app.locator("body").evaluate(() => location.reload());
        await expect(app.locator("#title")).toHaveText("Oak shelf", { timeout: 30_000 });
      }
      // The hash-routed demo moves by its fragment.
      const hash = demo(frame, "hash");
      await expect(hash.locator("#title")).toHaveText("Inventory", { timeout: 30_000 });
      await hash.locator("#item-1").click();
      await expect(hash.locator("#title")).toHaveText("Walnut desk");
    } finally {
      client.close();
    }
  });

  test("a comment inside a demo is anchored there and survives a reload (RV-01 on a demo)", async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    const client = await Client.connect(run.socket);
    try {
      const artifactId = await publishDemos(client, info);
      await page.setViewportSize({ width: 1280, height: 900 });
      const frame = await openInShell(page, await linkFor(client, artifactId, viewerName(info)));
      const target: Locator = demo(frame, "vite").locator('[data-review-id="demo.title"]');
      await expect(target).toHaveText("Inventory", { timeout: 30_000 });
      await page.locator("[data-mostra-comment-button]").click();
      await expect(page.locator("[data-mostra-review-surface]")).toBeVisible();
      const box = await target.boundingBox();
      if (!box) throw new Error("no box for the demo's title");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const composer = page.locator("[data-mostra-review-new] textarea");
      await composer.fill("Call it Stock.");
      await page.locator("[data-mostra-review-new] [data-mostra-review-post]").click();
      await expect(
        page.locator("[data-mostra-thread]", { hasText: "Call it Stock." }),
      ).toBeVisible();

      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-shell", "ready");
      await page.locator("[data-mostra-comment-button]").click();
      const card = page.locator("[data-mostra-thread]", { hasText: "Call it Stock." });
      await expect(card).toBeVisible();
      const id = await card.getAttribute("data-mostra-thread");
      await card.locator(".mostra-pin-static").click();
      await expect(page.locator(`[data-mostra-pin="${id}"]`)).toBeVisible();

      const exported = await client.call<{ content: string }>("review/export", {
        artifact: { artifactId },
        format: "json",
      });
      const comment = (
        JSON.parse(exported.content) as {
          comments: {
            messages: { text: string }[];
            anchor: { reviewId?: string; frames?: { served: boolean }[] };
          }[];
        }
      ).comments.find((one) => one.messages[0]?.text === "Call it Stock.");
      // Anchored inside the demo by its own review agent, not by the frame's box.
      expect(comment?.anchor.reviewId).toBe("demo.title");
      expect(comment?.anchor.frames?.[0]?.served).toBe(true);
    } finally {
      client.close();
    }
  });

  test("through a share on another site, worker-mode frames carry the demos too", async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    // A host's external base puts the shell on `localhost` and the artifact on `127.0.0.1`: two
    // sites, as a public tunnel does (D158 item 6).
    const daemon = await startDaemon();
    const host = await Client.connect(daemon.socket, {
      name: "addressing-host",
      ports: ["addressing"],
      onPortCall: (_method, params) => {
        const request = params as { listener: "shell" | "artifact"; local: string };
        const port = new URL(request.local).port;
        return {
          origin: `http://${request.listener === "shell" ? "localhost" : "127.0.0.1"}:${port}`,
        };
      },
    });
    try {
      const artifactId = await publishDemos(host, info);
      const { url } = await host.call<{ url: string }>("view/url", { artifact: { artifactId } });
      expect(new URL(url).hostname).toBe("localhost");
      await page.setViewportSize({ width: 1280, height: 900 });
      const frame = await openInShell(page, url);
      await moveThrough(demo(frame, "vite"));
      await moveThrough(demo(frame, "next"));
    } finally {
      host.close();
      daemon.child.kill("SIGTERM");
      await new Promise((resolve) => daemon.child.once("exit", resolve));
      removeTree(daemon.root);
    }
  });
});

test.describe("exports carry the page and its demos (VR-07)", () => {
  test("every class opens from disk; a hash demo moves there; a history demo says why it can't", async ({
    page,
    browserName,
  }, info) => {
    test.setTimeout(300_000);
    const client = await Client.connect(run.socket);
    try {
      const artifactId = await publishDemos(client, info);
      const staticExport = await exportAs(client, artifactId, "static", info);
      const html = await exportAs(client, artifactId, "html", info);
      const snapshot = await exportAs(client, artifactId, "snapshot", info);
      // The single file holds the demos it can (ES-module builds), and names the one it can't.
      const htmlReport = html.result["report"] as { demos: { name: string; carried: string }[] };
      expect(htmlReport.demos.find((one) => one.name === "next")?.carried).toBe("folder-only");
      expect(htmlReport.demos.find((one) => one.name === "vite")?.carried).not.toBe("folder-only");
      // A folder holding a history-routed demo says how to serve it.
      expect(readFileSync(join(staticExport.out, "README.txt"), "utf8")).toContain("npx serve");

      for (const entry of [
        pathToFileURL(join(staticExport.out, "index.html")).href,
        pathToFileURL(html.out).href,
        pathToFileURL(join(snapshot.out, "index.html")).href,
      ]) {
        await gotoShell(page, entry);
        await expect(page.getByRole("heading", { name: "The demos" })).toBeVisible();
        const vite = demo(page, "vite");
        await expect(vite.locator("#title")).toHaveText("Inventory", { timeout: 15_000 });
        await vite.locator("#count").click();
        await expect(vite.locator("#count")).toHaveText("Clicked 1");
        const hash = demo(page, "hash");
        await expect(hash.locator("#title")).toHaveText("Inventory", { timeout: 15_000 });
        await hash.locator("#item-2").click();
        await expect(hash.locator("#title")).toHaveText("Linen lamp");
        if (entry.endsWith(".html") && !entry.endsWith("index.html")) {
          // The single file names the demo it couldn't carry, in the page's own words.
          await expect(page.locator('[data-testid="next"]')).toContainText("single file");
        } else {
          const next = demo(page, "next");
          await expect(next.locator("#title")).toHaveText("Inventory", { timeout: 15_000 });
          await next.locator("#count").click();
          await expect(next.locator("#count")).toHaveText("Clicked 1");
        }
      }

      // From disk, a history-routed demo moving to another page: Chromium and WebKit refuse it,
      // and the demo's frame says why, once, in place; Firefox moves.
      await gotoShell(page, pathToFileURL(join(staticExport.out, "index.html")).href);
      const vite = demo(page, "vite");
      await expect(vite.locator("#title")).toHaveText("Inventory", { timeout: 15_000 });
      await vite.locator("#item-2").click();
      if (browserName === "firefox") {
        await expect(vite.locator("#title")).toHaveText("Linen lamp");
        await expect(vite.locator("[data-mostra-demo-notice]")).toHaveCount(0);
      } else {
        await expect(vite.locator("[data-mostra-demo-notice]")).toContainText(
          "needs this export to be opened through a web server",
        );
        await expect(vite.locator("#title")).toHaveText("Inventory");
      }
    } finally {
      client.close();
    }
  });

  test("a static export served at a host's root, and with --base /sub/ at /sub/, moves and deep-links", async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    const client = await Client.connect(run.socket);
    try {
      const artifactId = await publishDemos(client, info);
      const atRoot = await exportAs(client, artifactId, "static", info);
      const root = await serveFolder(atRoot.out);
      try {
        await gotoShell(page, root.url);
        await moveThrough(demo(page, "vite"));
        await moveThrough(demo(page, "next"));
      } finally {
        root.server.close();
      }

      const sub = await exportAs(client, artifactId, "static", info, { base: "/sub/" });
      const report = sub.result["report"] as { demos: { name: string; base?: string }[] };
      expect(report.demos.find((one) => one.name === "next")?.base).toBe(
        "/sub/_mostra/demos/next/",
      );
      const served = await serveFolder(sub.out, "/sub/");
      try {
        await gotoShell(page, served.url);
        for (const name of ["vite", "next"]) {
          const app = demo(page, name);
          await moveThrough(app);
          await app.locator("#item-3").click();
          await expect(app.locator("#title")).toHaveText("Oak shelf");
        }
        // A deep link into the Next.js demo at its subpath: its page is a file there.
        await gotoShell(page, `${served.url}_mostra/demos/next/items/2/`);
        await expect(page.locator("#title")).toHaveText("Linen lamp");
      } finally {
        served.server.close();
      }
    } finally {
      client.close();
    }
  });
});
