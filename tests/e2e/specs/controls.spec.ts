/// <reference lib="dom" />
/**
 * The shell's trusted controls in Chromium, Firefox and WebKit (WP-07): the artifact asks for a
 * label and gets it, but can't render, click, cover or forge the trusted Submit (SH-02, invariant
 * 7); a host that takes the shell channel only refuses the artifact's own submit and choice with
 * `MOSTRA_SUBMIT_CHANNEL_DENIED` (D40, D108); under policy `none` there is no Submit at all
 * (LL-02); and the viewer sees Submitted, Pending delivery, Delivered and Undeliverable in
 * order (IN-13).
 */
import { expect, type Page, test } from "@playwright/test";
import { linkFor, openInShell, publishOwn, results, saved, viewerName } from "../support/client.ts";
import { Client, readRun, removeTree, startDaemon } from "../support/mostra.ts";

const run = readRun();
/** The browser-protocol revision the pages here speak. */
const V = "2026-10-15";

/** The artifact's frame as a Playwright frame, to run the artifact's own code in it. */
function artifactFrame(page: Page) {
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  if (!frame) throw new Error("the shell has no frame");
  return frame;
}

/** Whether the artifact has any submission yet. */
async function hasSubmission(client: Client, artifactId: string): Promise<boolean> {
  try {
    await results(client, artifactId);
    return true;
  } catch (error) {
    if ((error as Error).message.startsWith("MOSTRA_SUBMIT_NOT_FOUND")) return false;
    throw error;
  }
}

test.describe("the artifact can't render, click or forge the trusted Submit (SH-02)", () => {
  test("synthetic clicks, overlays, requests to the shell's routes and forged bridge messages make no submission", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      const url = await linkFor(client, own.artifactId, viewerName(info));
      const frame = await openInShell(page, url);
      await frame.getByTestId("name").fill("Ana");
      await saved(page);
      const submit = page.locator("#mostra-submit");
      // The artifact asked for a label; the shell rendered the control in its own document.
      await expect(submit).toHaveText("Send answers");
      const code = artifactFrame(page);
      const shellOrigin = new URL(page.url()).origin;
      const attempts = await code.evaluate(
        async ({ shellOrigin, artifactId, V }) => {
          const outcome: Record<string, string> = {};
          // 1. Reach into the shell's document and click its button.
          try {
            (window.parent.document.getElementById("mostra-submit") as HTMLButtonElement).click();
            outcome["click"] = "clicked";
          } catch (error) {
            outcome["click"] = (error as Error).name;
          }
          // 2. Dispatch a synthetic click event at the shell's window.
          try {
            window.parent.dispatchEvent(new MouseEvent("click"));
            outcome["dispatch"] = "dispatched";
          } catch (error) {
            outcome["dispatch"] = (error as Error).name;
          }
          // 3. Call the shell's trusted submit route directly, with and without credentials.
          const target = `${shellOrigin}/a/${artifactId}/_mostra/v/${V}/submit`;
          const body = JSON.stringify({
            viewId: "vw_00000000000000000000000000",
            expectedRevision: "1",
          });
          try {
            const response = await fetch(target, {
              method: "POST",
              credentials: "include",
              headers: { "content-type": "application/json", "x-mostra-csrf": "guess" },
              body,
            });
            outcome["fetch"] = String(response.status);
          } catch (error) {
            outcome["fetch"] = (error as Error).name;
          }
          try {
            await fetch(target, { method: "POST", mode: "no-cors", credentials: "include", body });
            outcome["no-cors"] = "sent";
          } catch (error) {
            outcome["no-cors"] = (error as Error).name;
          }
          // 4. Forge bridge messages: a submit the bridge doesn't have, a fake answer, a reply to
          // a request the shell never sent.
          window.parent.postMessage(
            { jsonrpc: "2.0", id: 9001, method: "mostra/submit", params: {} },
            "*",
          );
          window.parent.postMessage(
            {
              jsonrpc: "2.0",
              method: "mostra/version.available",
              params: { versionId: "x", version: 9, orphans: 0 },
            },
            "*",
          );
          window.parent.postMessage(
            { jsonrpc: "2.0", id: 1, result: { revision: "99", unsaved: false, blockers: [] } },
            "*",
          );
          window.parent.postMessage("submit", "*");
          // 5. Cover the page with a look-alike Submit of its own and click it.
          const fake = document.createElement("button");
          fake.textContent = "Send answers";
          fake.style.cssText = "position:fixed;inset:0;z-index:2147483647;width:100vw;height:100vh";
          document.body.append(fake);
          fake.click();
          return outcome;
        },
        { shellOrigin, artifactId: own.artifactId, V },
      );
      expect(attempts["click"]).toBe("SecurityError");
      // A request from the artifact's origin can't use the shell's session (Origin, CSRF).
      expect(["403", "TypeError"]).toContain(attempts["fetch"]);
      // The frame's look-alike stays inside the frame: at the trusted Submit's centre the
      // shell's own button is on top, whatever the artifact draws.
      const box = await submit.boundingBox();
      if (!box) throw new Error("the trusted Submit has no box");
      const onTop = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id ?? "", {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      });
      expect(onTop).toBe("mostra-submit");
      // None of it made a submission, and the shell counted the forged messages it dropped.
      await expect(page.locator("html")).toHaveAttribute("data-bridge-rejections", /[1-9]/);
      expect(await hasSubmission(client, own.artifactId)).toBe(false);
      await expect(submit).toHaveText("Send answers");
      // The viewer's own click does submit, on the shell channel.
      await submit.click();
      await expect(submit).toHaveText("Submitted");
      const done = (await results(client, own.artifactId)) as { submission: { channel: string } };
      expect(done.submission.channel).toBe("shell");
    } finally {
      client.close();
    }
  });
});

test.describe("hosts choose the submit channels (SH-02, D40, D108)", () => {
  test("a host taking the shell channel only refuses the artifact's own submit and choice, and records the shell's", async ({
    page,
  }, info) => {
    // A home of this test's own: its channel setting applies to every artifact in it.
    const daemon = await startDaemon();
    const host = await Client.connect(daemon.socket, {
      name: "shell-only-host",
      home: { submitChannels: ["shell"] },
    });
    try {
      const own = await publishOwn(host, daemon.home, info);
      const viewer = viewerName(info);
      const frame = await openInShell(page, await linkFor(host, own.artifactId, viewer));
      await frame.getByTestId("name").fill("Ana");
      await saved(page);
      await expect(frame.getByTestId("submit-allowed")).toHaveText("false");
      await frame.getByTestId("artifact-submit").click();
      await expect(frame.getByTestId("result")).toHaveText("error:MOSTRA_SUBMIT_CHANNEL_DENIED");
      await frame.getByTestId("choose-airy").click();
      await expect(frame.getByTestId("result")).toHaveText("error:MOSTRA_SUBMIT_CHANNEL_DENIED");
      // The gateway refuses the artifact channel itself, whatever the page's code does.
      const viewId = await frame.getByTestId("view").textContent();
      const raw = await artifactFrame(page).evaluate(
        async ({ V, viewId }) => {
          const session = (await (await fetch("/_mostra/session")).json()) as { csrf: string };
          const response = await fetch(`/_mostra/v/${V}/submit`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-mostra-csrf": session.csrf },
            body: JSON.stringify({ viewId, expectedRevision: "1", channel: "artifact" }),
          });
          return {
            status: response.status,
            code: ((await response.json()) as { code: string }).code,
          };
        },
        { V, viewId },
      );
      expect(raw).toEqual({ status: 403, code: "MOSTRA_SUBMIT_CHANNEL_DENIED" });
      expect(await hasSubmission(host, own.artifactId)).toBe(false);
      // The trusted Choose and Submit work, on the shell channel, recording the viewer.
      await frame.getByTestId("show-airy").click();
      await page.locator("[data-mostra-choose=layout]").click();
      await expect(frame.getByTestId("choice")).toHaveText("airy");
      await page.locator("#mostra-submit").click();
      await expect(page.locator("#mostra-submit")).toHaveText("Submitted");
      const done = (await results(host, own.artifactId)) as {
        submission: { channel: string; viewer: { name?: string } };
        choices: { reviewSetId: string; candidateId: string; label?: string }[];
      };
      expect(done.submission.channel).toBe("shell");
      expect(done.submission.viewer.name).toBe(viewer);
      expect(done.choices).toEqual([{ reviewSetId: "layout", candidateId: "airy", label: "Airy" }]);
    } finally {
      host.close();
      daemon.child.kill("SIGTERM");
      await new Promise((resolve) => daemon.child.once("exit", resolve));
      removeTree(daemon.root);
    }
  });

  test("the artifact channel submits where the host allows it, and records the channel", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      const frame = await openInShell(
        page,
        await linkFor(client, own.artifactId, viewerName(info)),
      );
      await expect(frame.getByTestId("submit-allowed")).toHaveText("true");
      await expect(frame.getByTestId("blockers")).toHaveText("name:required");
      await frame.getByTestId("artifact-submit").click();
      await expect(frame.getByTestId("result")).toHaveText("error:MOSTRA_SUBMIT_BLOCKED");
      await frame.getByTestId("name").fill("Ana");
      await frame.getByTestId("artifact-submit").click();
      await expect(frame.getByTestId("result")).toHaveText(/^ok:/);
      await expect(frame.getByTestId("submit-state")).toHaveText(/submitted|delivered/);
      // The shell shows the submission the page made.
      await expect(page.locator("#mostra-submit")).toHaveText("Submitted");
      const done = (await results(client, own.artifactId)) as { submission: { channel: string } };
      expect(done.submission.channel).toBe("artifact");
    } finally {
      client.close();
    }
  });

  test("the trusted Submit lists required answers by label before it submits anything", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      const frame = await openInShell(
        page,
        await linkFor(client, own.artifactId, viewerName(info)),
      );
      await page.locator("#mostra-submit").click();
      await expect(page.locator("[data-mostra-blocker=name]")).toHaveText("Your name");
      expect(await hasSubmission(client, own.artifactId)).toBe(false);
      // Picking the blocker focuses the field in the frame.
      await page.locator("[data-mostra-blocker=name]").click();
      await expect(frame.getByTestId("name")).toBeFocused();
    } finally {
      client.close();
    }
  });

  test("under policy none the shell shows no Submit, and the page can't submit (LL-02)", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { policy: { policy: "none" } });
      const frame = await openInShell(
        page,
        await linkFor(client, own.artifactId, viewerName(info)),
      );
      await frame.getByTestId("name").fill("Ana");
      await saved(page);
      await expect(page.locator("#mostra-submit")).toHaveCount(0);
      await expect(frame.getByTestId("submit-state")).toHaveText("closed");
      await expect(frame.getByTestId("submit-allowed")).toHaveText("false");
      await frame.getByTestId("artifact-submit").click();
      await expect(frame.getByTestId("result")).toHaveText("error:MOSTRA_SUBMIT_POLICY_NONE");
      expect(await hasSubmission(client, own.artifactId)).toBe(false);
    } finally {
      client.close();
    }
  });
});

test.describe("the trusted Submit sends only what the page confirmed (GPT review finding 3)", () => {
  test("a page that doesn't answer the flush gets nothing submitted, and the viewer is told", async ({
    page,
  }, info) => {
    test.slow();
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      // The artifact's page never hears the shell's `mostra/flush` (an artifact may break its own
      // runtime): installed in the frame before the page's scripts, not in the shell's page.
      await page.addInitScript(() => {
        if (window.parent === window) return;
        const add = window.addEventListener.bind(window);
        window.addEventListener = ((type: string, listener: EventListener, options?: unknown) =>
          add(
            type,
            type === "message"
              ? (event: Event) => {
                  const data = (event as MessageEvent).data as { method?: string } | undefined;
                  if (data?.method !== "mostra/flush") listener(event);
                }
              : listener,
            options as AddEventListenerOptions,
          )) as typeof window.addEventListener;
      });
      const frame = await openInShell(
        page,
        await linkFor(client, own.artifactId, viewerName(info)),
      );
      await frame.getByTestId("name").fill("Ana");
      await saved(page);
      await page.locator("#mostra-submit").click();
      await expect(page.locator(".mostra-problem")).toContainText(
        "didn't confirm your answers are saved",
        { timeout: 20_000 },
      );
      expect(await hasSubmission(client, own.artifactId)).toBe(false);
    } finally {
      client.close();
    }
  });
});

test.describe("a link shows only the controls its scopes can use (D97, SH-02)", () => {
  test("a link without submit shows no trusted Submit, and the page can't submit either", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      const frame = await openInShell(
        page,
        await linkFor(client, own.artifactId, viewerName(info), { scopes: ["view", "draft"] }),
      );
      await frame.getByTestId("name").fill("Ana");
      await saved(page);
      await expect(page.locator("#mostra-submit")).toHaveCount(0);
      // No review scope: no trusted Choose either.
      await frame.getByTestId("show-dense").click();
      await expect(page.locator("[data-mostra-choose]")).toHaveCount(0);
      await expect(frame.getByTestId("submit-allowed")).toHaveText("false");
      await frame.getByTestId("artifact-submit").click();
      await expect(frame.getByTestId("result")).toHaveText("error:MOSTRA_HYGIENE_SCOPE_DENIED");
      expect(await hasSubmission(client, own.artifactId)).toBe(false);
    } finally {
      client.close();
    }
  });
});

test.describe("the viewer sees where the submission stands (IN-13)", () => {
  test("Submitted, then Pending delivery while the host is away, then Delivered; and Undeliverable", async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    const daemon = await startDaemon();
    const agent = await Client.connect(daemon.socket);
    // The host always provides the submissions port, so deliveries wait for it (D105), and then
    // it goes away.
    const away = await Client.connect(daemon.socket, {
      name: "jcode-like",
      ports: ["submissions"],
      home: { ports: ["submissions"] },
    });
    away.close();
    let host: Client | undefined;
    try {
      const own = await publishOwn(agent, daemon.home, info);
      const frame = await openInShell(page, await linkFor(agent, own.artifactId, viewerName(info)));
      await frame.getByTestId("name").fill("Ana");
      await saved(page);
      const receipt = page.locator("[data-mostra-receipt]");
      const seen: string[] = [];
      await page.exposeFunction("mostraSeen", (state: string) => seen.push(state));
      await page.evaluate(() => {
        // Each change of the receipt: its state, and whether it states the durable fact,
        // "Saved by Mostra" with the time (Submitted, D47).
        const record = (): void => {
          const receipt = document.querySelector("[data-mostra-receipt]");
          const state = receipt?.getAttribute("data-mostra-receipt");
          if (!state) return;
          const saved = receipt?.querySelector("li.mostra-ok time") ? "saved" : "unsaid";
          (window as unknown as { mostraSeen(s: string): void }).mostraSeen(`${state}/${saved}`);
        };
        new MutationObserver(record).observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["data-mostra-receipt"],
        });
      });
      await page.locator("#mostra-submit").click();
      await expect(receipt).toHaveAttribute("data-mostra-receipt", "pending", { timeout: 15_000 });
      await expect(page.locator("[data-mostra-delivery=pending]")).toContainText("jcode-like");
      // The host comes back and accepts.
      host = await Client.connect(daemon.socket, {
        name: "jcode-like",
        ports: ["submissions"],
        onPortCall: () => ({ accepted: true }),
      });
      await expect(receipt).toHaveAttribute("data-mostra-receipt", "delivered", {
        timeout: 15_000,
      });
      await expect(page.locator("[data-mostra-delivery=delivered]")).toContainText("jcode-like");
      // Every state the viewer saw says the submission is saved in Mostra; the delivery then
      // went Pending, then Delivered, never back. "Submitted" alone shows only until Mostra knows
      // the host is away; here it may know that already when the receipt first appears, since
      // the host left before the submit.
      expect(seen.every((entry) => entry.endsWith("/saved"))).toBe(true);
      const states = seen.map((entry) => entry.split("/")[0] as string);
      const order = states.filter((state, index) => state !== states[index - 1]);
      expect(["submitted,pending,delivered", "pending,delivered"]).toContain(order.join(","));
      host.close();
      // A host that can't take a submission says so, and the viewer sees it.
      host = await Client.connect(daemon.socket, {
        name: "jcode-like",
        ports: ["submissions"],
        onPortCall: () => ({ accepted: false, reason: "undeliverable", retry: false }),
      });
      const second = await publishOwn(agent, daemon.home, info);
      const page2 = await page.context().newPage();
      const frame2 = await openInShell(
        page2,
        await linkFor(agent, second.artifactId, viewerName(info, "-2")),
      );
      await frame2.getByTestId("name").fill("Ben");
      await saved(page2);
      await page2.locator("#mostra-submit").click();
      await expect(page2.locator("[data-mostra-receipt]")).toHaveAttribute(
        "data-mostra-receipt",
        "undeliverable",
        { timeout: 15_000 },
      );
      await expect(page2.locator("[data-mostra-delivery=undeliverable]")).toContainText(
        "jcode-like",
      );
      // Reopened later, the page shows the same state: nothing depends on the tab that submitted.
      await page2.reload();
      await expect(page2.locator("[data-mostra-receipt]")).toHaveAttribute(
        "data-mostra-receipt",
        "undeliverable",
        { timeout: 20_000 },
      );
    } finally {
      host?.close();
      agent.close();
      daemon.child.kill("SIGTERM");
      await new Promise((resolve) => daemon.child.once("exit", resolve));
      removeTree(daemon.root);
    }
  });
});
