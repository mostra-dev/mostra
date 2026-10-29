/// <reference lib="dom" />
/**
 * Worker-mode frame sessions in Chromium, Firefox and WebKit (HY-07, D70, D158): a host's
 * `addressing` port puts the shell and the artifact on two sites (`localhost` and `127.0.0.1`,
 * cross-site as two tunnel hostnames are), so the frame can't use cookies and enters through the
 * bootstrap page and Mostra's service worker. Fields save and survive a reload, another device's
 * edit arrives on the ticketed stream, the artifact's own service workers are refused with a
 * diagnostic, and a base the host withdraws stops working (HO-10).
 */
import { cpSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { E2E_FIXTURES, openInShell, saved } from "../support/client.ts";
import { Client, removeTree, startDaemon } from "../support/mostra.ts";

interface Base {
  readonly artifactId: string;
  readonly listener: "shell" | "artifact";
  readonly local: string;
}

/** The host's answer: the shell on `localhost`, the artifact on `127.0.0.1`, the face's own ports. */
function crossSite(request: Base): { origin: string } {
  const port = new URL(request.local).port;
  return { origin: `http://${request.listener === "shell" ? "localhost" : "127.0.0.1"}:${port}` };
}

test.describe("worker-mode frames across sites (HY-07)", () => {
  // One daemon and one host for the suite: the host's answers are its state.
  test.describe.configure({ mode: "serial" });
  let daemon: Awaited<ReturnType<typeof startDaemon>>;
  let host: Client;
  let artifactId = "";
  let withdrawn = false;

  test.beforeAll(async () => {
    daemon = await startDaemon();
    host = await Client.connect(daemon.socket, {
      name: "addressing-host",
      ports: ["addressing"],
      onPortCall: (method, params) => {
        if (method !== "port/addressing.externalBase") throw new Error(`unexpected ${method}`);
        return withdrawn ? null : crossSite(params as Base);
      },
    });
    const dir = join(dirname(daemon.home), "sources", "worker-conflict");
    cpSync(join(E2E_FIXTURES, "worker-conflict"), dir, { recursive: true });
    ({ artifactId } = await host.call<{ artifactId: string }>("artifact/publish", {
      source: { path: dir },
    }));
  });

  test.afterAll(async () => {
    host?.close();
    daemon?.child.kill("SIGTERM");
    await new Promise((resolve) => daemon?.child.once("exit", resolve));
    if (daemon) removeTree(daemon.root);
  });

  const link = async (): Promise<string> =>
    (await host.call<{ url: string }>("view/url", { artifact: { artifactId } })).url;

  /** The frame's own facts, read from inside it. */
  const inFrame = (page: Page) => {
    const frame = page.frames().find((one) => one.url().startsWith("http://127.0.0.1:"));
    if (!frame)
      throw new Error(
        `no artifact frame among ${page
          .frames()
          .map((f) => f.url())
          .join(", ")}`,
      );
    return frame;
  };

  test("enters through the bootstrap page and Mostra's service worker, saves, and survives a reload", async ({
    page,
  }) => {
    const url = await link();
    expect(new URL(url).hostname).toBe("localhost");
    const frame = await openInShell(page, url);
    const inside = inFrame(page);
    expect(new URL(inside.url()).hostname).toBe("127.0.0.1");
    const worker = await inside.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "");
    expect(new URL(worker).pathname).toBe("/_mostra/sw.js");
    // No cookie of the artifact's origin exists: the session is the worker's header.
    expect((await page.context().cookies(inside.url())).length).toBe(0);
    await frame.getByTestId("note").fill("Across sites");
    await saved(page);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-shell", "ready", { timeout: 20_000 });
    await expect(page.frameLocator("iframe.mostra-frame").getByTestId("note")).toHaveValue(
      "Across sites",
    );
  });

  test("hears another device's edit on its ticketed stream", async ({ page, browser }) => {
    const url = await link();
    // The page's event stream opens with a single-use ticket, past the service worker (D70).
    const streams: string[] = [];
    page.on("response", (response) => {
      const target = new URL(response.url());
      if (target.hostname === "127.0.0.1" && /\/_mostra\/v\/[^/]+\/events$/.test(target.pathname)) {
        streams.push(`${response.status()} ${target.searchParams.has("ticket")}`);
      }
    });
    const frame = await openInShell(page, url);
    const other = await browser.newContext();
    try {
      const elsewhere = await openInShell(await other.newPage(), url);
      await elsewhere.getByTestId("note").fill("From the other device");
      await expect(frame.getByTestId("note")).toHaveValue("From the other device", {
        timeout: 15_000,
      });
      expect(streams).toContain("200 true");
    } finally {
      await other.close();
    }
  });

  test("refuses the artifact's own service workers with MOSTRA_HYGIENE_FRAME_SESSION", async ({
    page,
  }) => {
    const frame = await openInShell(page, await link());
    await frame.getByTestId("root").click();
    await expect(frame.getByTestId("root-outcome")).toHaveText("MOSTRA_HYGIENE_FRAME_SESSION");
    await frame.getByTestId("narrow").click();
    await expect(frame.getByTestId("narrow-outcome")).toHaveText("MOSTRA_HYGIENE_FRAME_SESSION");
    // Mostra's worker still signs the page: a save still lands.
    await frame.getByTestId("note").fill("Still saved");
    await saved(page);
  });

  test("tells the viewer when the browser won't let the frame start its service worker", async ({
    browser,
  }) => {
    // Service workers blocked, as private windows and some settings block them (FAILURE_MODEL §8).
    const blocked = await browser.newContext({ serviceWorkers: "block" });
    try {
      const page = await blocked.newPage();
      await page.goto(await link());
      await expect(page.locator("html")).toHaveAttribute(
        "data-frame-session",
        /^(blocked|unsupported)$/,
        { timeout: 30_000 },
      );
      await expect(page.getByText(/needs service workers/)).toBeVisible();
      // It doesn't keep reloading a frame that would only fail again.
      await page.waitForTimeout(8_000);
      await expect(page.locator("html")).not.toHaveAttribute("data-frame-reloads", /[1-9]|gave-up/);
      await expect(page.locator("html")).not.toHaveAttribute("data-shell", "ready");
    } finally {
      await blocked.close();
    }
  });

  test("stops working at a base the host withdraws, and mints loopback links after", async ({
    page,
    browser,
  }) => {
    const external = await link();
    // A viewer has the page open at the host's address.
    await openInShell(page, external);
    withdrawn = true;
    const other = await browser.newContext();
    try {
      // The host withdraws its address without a new link being minted: the next exchange there
      // asks it again and is refused, and the address's listeners close.
      const fresh = await other.newPage();
      const exchanges: number[] = [];
      fresh.on("response", (response) => {
        if (/\/a\/[^/]+\/_mostra\/session$/.test(new URL(response.url()).pathname)) {
          if (response.request().method() === "POST") exchanges.push(response.status());
        }
      });
      await fresh.goto(external).catch(() => undefined);
      await expect.poll(() => exchanges, { timeout: 15_000 }).toEqual([410]);
      await expect(fresh.locator("html")).not.toHaveAttribute("data-shell", "ready");
      // The page that was open stops working too: its address is refused (421) while its listener
      // closes, then answers nothing at all.
      const reloaded = await page.reload().then(
        (response) => response?.status() ?? 0,
        () => 0,
      );
      expect([0, 421]).toContain(reloaded);
      // Links are minted on loopback again.
      const local = await link();
      expect(new URL(local).hostname).toBe("127.0.0.1");
      // The loopback link opens in cookie mode, where the page registers its own workers.
      const frame = await openInShell(await page.context().newPage(), local);
      await frame.getByTestId("narrow").click();
      await expect(frame.getByTestId("narrow-outcome")).toHaveText("registered");
      await frame.getByTestId("root").click();
      await expect(frame.getByTestId("root-outcome")).toHaveText("registered");
    } finally {
      withdrawn = false;
      await other.close();
    }
  });
});
