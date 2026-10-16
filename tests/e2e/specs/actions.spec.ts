/// <reference lib="dom" />
/**
 * Actions and live data in Chromium, Firefox and WebKit through the real shell, gateway and
 * workers (WP-08): J3's inbox sends once however often "Send" is clicked, in one tab or two
 * (AC-03), a run survives a reload and is shown again (AC-02), a cancel reaches the action
 * (AC-04), and live values flow into the page without durable events (AC-07, LL-04).
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, type Page, test } from "@playwright/test";
import { linkFor, openInShell, publishOwn, viewerName } from "../support/client.ts";
import { Client, readRun } from "../support/mostra.ts";

const run = readRun();

/** A counting fake mail API: every POST is one email. */
async function fakeMail(): Promise<{ server: Server; url: string; sent: unknown[] }> {
  const sent: unknown[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      sent.push(JSON.parse(body));
      // A slow provider: a second click lands while the first send is in flight.
      setTimeout(() => response.end(JSON.stringify({ ok: true })), 500);
    });
  }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/send`, sent };
}

async function inbox(
  client: Client,
  info: import("@playwright/test").TestInfo,
  mailUrl?: string,
): Promise<{ artifactId: string; url: string }> {
  const own = await publishOwn(client, run.home, info, { fixture: "inbox" });
  if (mailUrl) {
    await client.call("secret/set", {
      name: "MAIL_URL",
      value: mailUrl,
      artifact: { artifactId: own.artifactId },
    });
  }
  return {
    artifactId: own.artifactId,
    url: await linkFor(client, own.artifactId, viewerName(info)),
  };
}

const ready = async (page: Page) => {
  const frame = page.frameLocator("iframe.mostra-frame");
  await expect(frame.getByTestId("inbox-state")).toHaveText("1 messages", { timeout: 20_000 });
  return frame;
};

test.describe("J3's inbox", () => {
  test("sends a reply once for a double click and a second tab, with a secret it never shows (AC-03)", async ({
    page,
    browser,
  }, info) => {
    const client = await Client.connect(run.socket);
    const mail = await fakeMail();
    try {
      const own = await inbox(client, info, mail.url);
      await openInShell(page, own.url);
      const frame = await ready(page);
      await frame.getByTestId("reply-m1").fill("Thursday at noon.");
      await frame.getByTestId("send-m1").dblclick();
      // A second tab of the same viewer clicks too, while the first send is in flight.
      const other = await browser.newContext();
      try {
        const second = await other.newPage();
        await openInShell(second, own.url);
        const secondFrame = await ready(second);
        await secondFrame.getByTestId("send-m1").click();
        await expect(secondFrame.getByTestId("send-m1-status")).toHaveText("succeeded", {
          timeout: 20_000,
        });
      } finally {
        await other.close();
      }
      await expect(frame.getByTestId("send-m1")).toHaveText("Sent", { timeout: 20_000 });
      // A reload shows the sent state again, and clicking once more sends nothing.
      await page.reload();
      const again = await ready(page);
      await expect(again.getByTestId("send-m1")).toHaveText("Sent", { timeout: 20_000 });
      await again.getByTestId("send-m1").click();
      await page.waitForTimeout(1000);
      expect(mail.sent).toEqual([{ id: "m1", body: "Thursday at noon." }]);
      // Nothing of the secret reached the page.
      expect(await page.content()).not.toContain(mail.url);
    } finally {
      mail.server.close();
      client.close();
    }
  });

  test("keeps a run going through a reload and shows it again with its progress (AC-02)", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await inbox(client, info);
      await openInShell(page, own.url);
      const frame = await ready(page);
      await frame.getByTestId("export").click();
      await expect(frame.getByTestId("export-status")).toHaveText("running", { timeout: 20_000 });
      await expect(frame.getByTestId("export-progress")).toHaveText(/Page \d+ of 10/);
      await page.reload();
      const again = await ready(page);
      // Re-attached by its key: the same run, still progressing, then done.
      await expect(again.getByTestId("export-progress")).toHaveText(/Page \d+ of 10/, {
        timeout: 20_000,
      });
      await expect(again.getByTestId("export-status")).toHaveText("succeeded", { timeout: 20_000 });
      await expect(again.getByTestId("export-pages")).toHaveText("10");
      await expect(again.getByTestId("export-log")).toHaveText("10");
      const events = await client.call<{ events: { type: string }[] }>("events/read", {
        filter: { artifacts: [own.artifactId], types: ["action.*"] },
      });
      expect(events.events.map((event) => event.type)).toEqual([
        "action.started",
        "action.succeeded",
      ]);
    } finally {
      client.close();
    }
  });

  test("cancels a run through the action's abort signal (AC-04)", async ({ page }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await inbox(client, info);
      await openInShell(page, own.url);
      const frame = await ready(page);
      await frame.getByTestId("job").click();
      await expect(frame.getByTestId("job-status")).toHaveText("running", { timeout: 20_000 });
      await frame.getByTestId("job-cancel").click();
      await expect(frame.getByTestId("job-status")).toHaveText("cancelled", { timeout: 20_000 });
      await expect(frame.getByTestId("job-error")).toHaveText("MOSTRA_ACTION_CANCELLED");
    } finally {
      client.close();
    }
  });

  test("shows live values as they come, with no durable event (AC-07, LL-04)", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await inbox(client, info);
      await openInShell(page, own.url);
      const frame = await ready(page);
      await expect(frame.getByTestId("ticks-count")).toHaveText("5", { timeout: 20_000 });
      const first = Number(await frame.getByTestId("ticks-last").textContent());
      await expect
        .poll(async () => Number(await frame.getByTestId("ticks-last").textContent()), {
          timeout: 10_000,
        })
        .toBeGreaterThan(first + 5);
      // A push from the host protocol reaches the page the same way (D56).
      await client.call("live/push", {
        artifact: { artifactId: own.artifactId },
        key: "inbox",
        value: { messages: [] },
      });
      await expect(frame.getByTestId("inbox-state")).toHaveText("0 messages", { timeout: 10_000 });
      const events = await client.call<{ events: { type: string }[] }>("events/read", {
        filter: { artifacts: [own.artifactId] },
        limit: 100,
      });
      expect(events.events.map((event) => event.type)).not.toContainEqual(
        expect.stringMatching(/^live/),
      );
    } finally {
      client.close();
    }
  });
});
