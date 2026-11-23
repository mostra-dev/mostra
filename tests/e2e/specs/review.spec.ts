/// <reference lib="dom" />
/**
 * The review layer (WP-20; D23, RV-01, RV-02, RV-04) in Chromium, Firefox and WebKit through the
 * real gateway, shell and daemon: comments pin on native DOM, a canvas, a kit chart, a frame the
 * artifact serves and an opaque frame; each anchor stores every layer that applies and always a
 * crop (captured by the daemon's verify runner); the pins come back after a reload; and the
 * comments arrive with the submission, crops by paths that exist.
 */
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type FrameLocator, type Locator, type Page, test } from "@playwright/test";
import { PNG } from "pngjs";
import { linkFor, openInShell, publishOwn, viewerName } from "../support/client.ts";
import { Client, readRun } from "../support/mostra.ts";

const run = readRun();

interface Anchor {
  readonly reviewId?: string;
  readonly selectors?: readonly {
    readonly type: string;
    readonly value?: string;
    readonly exact?: string;
  }[];
  readonly rect?: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly viewport?: { readonly width: number; readonly height: number; readonly dpr: number };
  readonly provider?: { readonly kind: string; readonly data: Record<string, unknown> };
  readonly frames?: readonly { readonly selector: string; readonly served: boolean }[];
}

interface Comment {
  readonly threadId: string;
  readonly status: string;
  readonly anchor: Anchor;
  readonly crop: {
    readonly path: string;
    readonly width: number;
    readonly height: number;
    readonly state?: string;
  };
  readonly messages: readonly { readonly text: string }[];
}

/** Puts the overlay in comment mode, points at the middle of `target`, and posts `text`. */
async function comment(page: Page, target: Locator, text: string): Promise<void> {
  // In view first, as a person scrolls to what they comment on.
  await target.scrollIntoViewIfNeeded();
  await page.locator("[data-mostra-comment-button]").click();
  await expect(page.locator("[data-mostra-review-surface]")).toBeVisible();
  // The panel opened beside the page, which may have moved: where the target is now.
  const box = await target.boundingBox();
  if (!box) throw new Error(`No box for ${text}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const composer = page.locator("[data-mostra-review-new] textarea");
  await expect(composer).toBeVisible();
  await composer.fill(text);
  await page.locator("[data-mostra-review-new] [data-mostra-review-post]").click();
  await expect(page.locator("[data-mostra-review-new]")).toHaveCount(0);
  await expect(page.locator(`[data-mostra-thread]`, { hasText: text })).toBeVisible();
}

test.describe("comments on any content (RV-01, RV-02)", () => {
  test("pin on DOM, canvas, a kit chart, a served frame and an opaque frame, survive a reload and arrive with the submission", async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "review" });
      const url = await linkFor(client, own.artifactId, viewerName(info));
      await page.setViewportSize({ width: 1280, height: 900 });
      const frame: FrameLocator = await openInShell(page, url);
      await expect(page.locator("html")).toHaveAttribute("data-shell", "ready");
      // The served frame's page carries the injected agent; wait until it loaded.
      await expect(
        frame.frameLocator('[data-testid="served"]').locator("#embed-line"),
      ).toBeVisible();

      await comment(page, frame.locator('[data-review-id="header.title"]'), "The title wraps.");
      await comment(page, frame.locator('[data-testid="canvas"]'), "The blue box is too wide.");
      await comment(page, frame.locator(".recharts-bar-rectangle").nth(1), "February looks off.");
      await comment(
        page,
        frame.frameLocator('[data-testid="served"]').locator('[data-review-id="embed.heading"]'),
        "Rename the embedded plan.",
      );
      await expect(
        frame.frameLocator('[data-testid="served-sandboxed"]').locator("#embed-line"),
      ).toBeVisible();
      await comment(
        page,
        frame
          .frameLocator('[data-testid="served-sandboxed"]')
          .locator('[data-review-id="embed.heading"]'),
        "The sandboxed plan's heading is too small.",
      );
      await comment(page, frame.locator('[data-testid="opaque"]'), "What is this page?");

      // Six pins, numbered, each beside its place.
      await expect(page.locator("[data-mostra-pin]")).toHaveCount(6);
      // Every crop is captured by the daemon's verify runner (the capture port's default).
      await expect(page.locator('[data-mostra-crop="captured"]')).toHaveCount(6, {
        timeout: 120_000,
      });

      // A reload shows the same pins, placed by the page again.
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-shell", "ready");
      await expect(page.locator("[data-mostra-pin]")).toHaveCount(6);

      // What the host reads: every layer that applies, and always a crop.
      const exported = await client.call<{ content: string }>("review/export", {
        artifact: { artifactId: own.artifactId },
        format: "json",
      });
      const review = JSON.parse(exported.content) as { comments: Comment[] };
      const byText = (text: string): Comment => {
        const found = review.comments.find((entry) => entry.messages[0]?.text === text);
        if (!found) throw new Error(`No comment "${text}" in ${exported.content}`);
        return found;
      };
      for (const entry of review.comments) {
        expect(entry.crop.state ?? "captured").toBe("captured");
        expect(entry.crop.width).toBeGreaterThan(0);
        expect(existsSync(entry.crop.path)).toBe(true);
        expect(entry.anchor.viewport?.width).toBeGreaterThan(0);
        expect(entry.anchor.rect?.width).toBeGreaterThan(0);
      }
      const header = byText("The title wraps.");
      expect(header.anchor.reviewId).toBe("header.title");
      expect(header.anchor.selectors?.some((selector) => selector.type === "CssSelector")).toBe(
        true,
      );
      expect(
        header.anchor.selectors?.find((selector) => selector.type === "TextQuoteSelector")?.exact,
      ).toBe("Sidebar redesign");
      const canvas = byText("The blue box is too wide.");
      expect(
        canvas.anchor.selectors?.find((selector) => selector.type === "CssSelector")?.value,
      ).toContain("canvas");
      // A place on the canvas, not the whole canvas.
      expect(canvas.anchor.rect?.width).toBeLessThanOrEqual(64);
      const chart = byText("February looks off.");
      expect(chart.anchor.provider?.kind).toBe("chart-datum");
      expect(chart.anchor.provider?.data["datum"]).toBe("February");
      const served = byText("Rename the embedded plan.");
      expect(served.anchor.frames?.[0]?.served).toBe(true);
      expect(served.anchor.reviewId).toBe("embed.heading");
      // A page the artifact can't read itself anchors semantically too: its own review agent,
      // which every page of the version carries, answers for it.
      const sandboxed = byText("The sandboxed plan's heading is too small.");
      expect(sandboxed.anchor.reviewId).toBe("embed.heading");
      expect(sandboxed.anchor.frames?.[0]?.served).toBe(true);
      const opaque = byText("What is this page?");
      expect(opaque.anchor.frames?.[0]?.served).toBe(false);

      // Submitted, the comments arrive with the answers (RV-03's comment half).
      await page.locator("#mostra-submit").click();
      await expect(page.locator("[data-mostra-submission]")).toBeVisible();
      const results = await client.call<{ comments: Comment[] }>("results/get", {
        artifact: { artifactId: own.artifactId },
      });
      expect(results.comments).toHaveLength(6);
      for (const entry of results.comments) expect(existsSync(entry.crop.path)).toBe(true);
    } finally {
      client.close();
    }
  });
});

test.describe("review sets (RV-03)", () => {
  test("gallery, focus, synchronized compare of two to four with a pixel difference, and a trusted Choose that arrives with the comments", async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "review-set" });
      const url = await linkFor(client, own.artifactId, viewerName(info));
      await page.setViewportSize({ width: 1280, height: 900 });
      const frame = await openInShell(page, url);
      await expect(page.locator("html")).toHaveAttribute("data-shell", "ready");
      const sidebar = frame.locator('[data-mostra-review-set="sidebar"]');
      // Pictures for the design review, when asked for (MOSTRA_E2E_SCREENS, as surfaces.spec.ts).
      const screens = process.env["MOSTRA_E2E_SCREENS"];
      const shoot = async (name: string): Promise<void> => {
        if (!screens) return;
        const dir = join(screens, info.project.name, "light-1280");
        mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: join(dir, `review-set-${name}.png`) });
      };

      // Compare: two side by side, then a third, then back to two; at most four.
      await expect(sidebar.locator("[data-mostra-candidate]")).toHaveCount(2);
      await sidebar.locator('[data-review-candidate="roomy"]').click();
      await expect(sidebar.locator("[data-mostra-candidate]")).toHaveCount(3);
      await shoot("compare-three");
      // Synchronized: scrolling one compared candidate scrolls the others to the same place.
      await sidebar.locator('[data-mostra-candidate="dense"]').evaluate((pane) => {
        pane.scrollTop = 200;
        pane.dispatchEvent(new Event("scroll"));
      });
      await expect
        .poll(() =>
          sidebar.locator('[data-mostra-candidate="roomy"]').evaluate((pane) => pane.scrollTop),
        )
        .toBe(200);
      await sidebar.locator('[data-review-candidate="roomy"]').click();
      await expect(sidebar.locator("[data-mostra-candidate]")).toHaveCount(2);
      await sidebar.locator('[data-mostra-candidate="dense"]').evaluate((pane) => {
        pane.scrollTop = 0;
        pane.dispatchEvent(new Event("scroll"));
      });

      // The difference: where Dense and Airy agree is black, where they differ (the accent) isn't.
      await sidebar.locator("[data-review-difference]").click();
      const grid = sidebar.locator("[data-review-grid]");
      await expect(grid).toHaveAttribute("data-difference", "");
      await shoot("difference");
      const gridBox = await grid.boundingBox();
      const accent = await frame.locator('[data-testid="accent-dense"]').boundingBox();
      const title = await frame.locator('[data-review-id="sidebar.dense.title"]').boundingBox();
      if (!gridBox || !accent || !title) throw new Error("No boxes for the difference.");
      const shot = PNG.sync.read(await grid.screenshot());
      const scale = shot.width / gridBox.width;
      const pixel = (x: number, y: number): [number, number, number] => {
        const at =
          (Math.round((y - gridBox.y) * scale) * shot.width + Math.round((x - gridBox.x) * scale)) *
          4;
        return [shot.data[at] ?? 0, shot.data[at + 1] ?? 0, shot.data[at + 2] ?? 0];
      };
      const sum = (rgb: [number, number, number]): number => rgb[0] + rgb[1] + rgb[2];
      // Identical white ground: black.
      expect(sum(pixel(title.x + title.width + 40, title.y + title.height / 2))).toBeLessThan(30);
      // Blue against red: far from black.
      expect(sum(pixel(accent.x + accent.width / 2, accent.y + accent.height / 2))).toBeGreaterThan(
        200,
      );
      await sidebar.locator("[data-review-difference]").click();

      // Focus: one candidate at a time.
      const tone = frame.locator('[data-mostra-review-set="tone"]');
      await expect(tone.locator("[data-mostra-candidate]")).toHaveCount(1);
      await tone.locator('[data-review-candidate="cool"]').click();
      await expect(tone.locator('[data-mostra-candidate="cool"]')).toBeVisible();
      await expect(tone.locator('[data-mostra-candidate="warm"]')).toHaveCount(0);
      // Gallery: every candidate.
      await expect(
        frame.locator('[data-mostra-review-set="icons"] [data-mostra-candidate]'),
      ).toHaveCount(3);

      // The trusted Choose names the candidate in view, in the shell.
      // In compare, a click inside a candidate puts it in view.
      await sidebar.locator('[data-mostra-candidate="airy"] h3').click();
      const choose = page.locator('[data-mostra-choose="sidebar"]');
      await expect(choose).toHaveText("Choose Airy");
      await expect(page.locator("[data-mostra-trusted]")).toHaveAttribute("data-mostra-armed", "");
      await choose.click();
      await expect(choose).toHaveText("Chosen: Airy");
      await shoot("chosen");

      // A comment on a candidate records its set and candidate.
      await comment(
        page,
        sidebar.locator('[data-mostra-candidate="airy"] h3'),
        "Airy's title is right.",
      );
      await expect(page.locator('[data-mostra-crop="captured"]')).toHaveCount(1, {
        timeout: 120_000,
      });

      await page.locator("#mostra-submit").click();
      await expect(page.locator("[data-mostra-submission]")).toBeVisible();
      const results = await client.call<{
        choices: { reviewSetId: string; candidateId: string; label?: string }[];
        comments: Comment[];
      }>("results/get", { artifact: { artifactId: own.artifactId } });
      expect(results.choices).toEqual([
        { reviewSetId: "sidebar", candidateId: "airy", label: "Airy" },
      ]);
      expect(results.comments).toHaveLength(1);
      const anchor = results.comments[0]?.anchor as Anchor & {
        reviewSetId?: string;
        candidateId?: string;
      };
      expect(anchor.reviewSetId).toBe("sidebar");
      expect(anchor.candidateId).toBe("airy");
      expect(anchor.reviewId).toBe("sidebar.airy.title");
    } finally {
      client.close();
    }
  });
});

test.describe("the artifact can't hide or forge the review overlay (RV-04)", () => {
  test("reaching into the shell, calling its review routes, forged bridge messages and look-alike pins make, hide and resolve nothing", async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "review" });
      const url = await linkFor(client, own.artifactId, viewerName(info));
      await page.setViewportSize({ width: 1280, height: 900 });
      const frame = await openInShell(page, url);
      await expect(page.locator("html")).toHaveAttribute("data-shell", "ready");
      await comment(page, frame.locator("h1"), "The real comment.");
      const pin = page.locator("[data-mostra-pin]");
      await expect(pin).toHaveCount(1);
      const threadId = (await pin.getAttribute("data-mostra-pin")) ?? "";
      const code = page.frames().find((candidate) => candidate !== page.mainFrame());
      if (!code) throw new Error("the shell has no frame");
      const shellOrigin = new URL(page.url()).origin;
      const attempts = await code.evaluate(
        async ({ shellOrigin, artifactId, threadId }) => {
          const outcome: Record<string, string> = {};
          const base = `${shellOrigin}/a/${artifactId}/_mostra/v/2026-10-15/review/threads`;
          // 1. Reach into the shell's document to remove the pins and the panel.
          try {
            for (const node of window.parent.document.querySelectorAll("[data-mostra-pin]")) {
              node.remove();
            }
            outcome["reach"] = "reached";
          } catch (error) {
            outcome["reach"] = (error as Error).name;
          }
          // 2. Call the shell's review routes: start a thread, resolve the viewer's.
          const post = async (path: string, body: unknown): Promise<string> => {
            try {
              const response = await fetch(`${base}${path}`, {
                method: "POST",
                credentials: "include",
                headers: { "content-type": "application/json", "x-mostra-csrf": "guess" },
                body: JSON.stringify(body),
              });
              return String(response.status);
            } catch (error) {
              return (error as Error).name;
            }
          };
          outcome["start"] = await post("", {
            viewId: "vw_00000000000000000000000000",
            threadId: "thr_00000000000000000000000000",
            commentId: "cmt_00000000000000000000000000",
            text: "Forged.",
            anchor: {},
          });
          outcome["resolve"] = await post(`/${threadId}/status`, {
            viewId: "vw_00000000000000000000000000",
            status: "resolved",
          });
          // 3. Forged bridge messages: a hit test from the wrong side, a track the page can't send,
          // positions that throw the viewer's pin far off the page and name a thread never made.
          window.parent.postMessage(
            { jsonrpc: "2.0", id: 7001, method: "mostra/review.hitTest", params: { x: 1, y: 1 } },
            "*",
          );
          window.parent.postMessage(
            { jsonrpc: "2.0", method: "mostra/review.track", params: { anchors: [] } },
            "*",
          );
          // The page's runtime keeps reporting the true place; a hostile page keeps lying, faster.
          const forged = {
            jsonrpc: "2.0",
            method: "mostra/review.positions",
            params: {
              positions: [
                { id: threadId, rect: { x: 99999, y: -99999, width: 1, height: 1 }, layer: "rect" },
                {
                  id: "thr_00000000000000000000000000",
                  rect: { x: 10, y: 10, width: 9, height: 9 },
                  layer: "rect",
                },
              ],
            },
          };
          window.parent.postMessage(forged, "*");
          setInterval(() => window.parent.postMessage(forged, "*"), 10);
          // 4. A look-alike overlay of the page's own: fake pins and a fake resolved panel on top.
          const fake = document.createElement("div");
          fake.innerHTML =
            '<button class="mostra-pin" style="position:fixed;left:40px;top:40px">9</button>' +
            '<aside style="position:fixed;inset:0;background:white;z-index:2147483647">Resolved: nothing to review</aside>';
          document.body.append(fake);
          return outcome;
        },
        { shellOrigin, artifactId: own.artifactId, threadId },
      );
      expect(attempts["reach"]).toBe("SecurityError");
      expect(["403", "TypeError"]).toContain(attempts["start"]);
      expect(["403", "TypeError"]).toContain(attempts["resolve"]);
      // The shell dropped what the page may not send, and drew no pin for a thread nobody made.
      await expect(page.locator("html")).toHaveAttribute("data-bridge-rejections", /[1-9]/);
      await expect(pin).toHaveCount(1);
      // The viewer's pin is still whole, inside the page's box, wherever the page says it is:
      // sampled while the page keeps lying.
      const stage = await page.locator(".mostra-frame").boundingBox();
      if (!stage) throw new Error("the frame has no box");
      for (let sample = 0; sample < 10; sample += 1) {
        // Where the pin stands, not where its drop-in animation passes through.
        await pin.evaluate((element) =>
          Promise.all(element.getAnimations().map((animation) => animation.finished)),
        );
        const box = await pin.boundingBox();
        expect(box, "the pin is drawn").not.toBeNull();
        if (!box) break;
        expect(box.x).toBeGreaterThanOrEqual(stage.x - 1);
        expect(box.y).toBeGreaterThanOrEqual(stage.y - 1);
        expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
        expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
        await page.waitForTimeout(100);
      }
      const box = await pin.boundingBox();
      if (!box) throw new Error("the pin has no box");
      // At the pin's centre the shell's own pin is on top, whatever the page draws under it.
      const onTop = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-mostra-pin") ?? "",
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      );
      expect(onTop).toBe(threadId);
      // The panel, the shell's, lists the one real thread, open.
      const thread = page.locator(`[data-mostra-thread="${threadId}"]`);
      await expect(page.locator("[data-mostra-thread]")).toHaveCount(1);
      await expect(thread).toContainText("The real comment.");
      // The instance holds that thread alone, open: nothing the page tried took effect.
      const exported = await client.call<{ content: string }>("review/export", {
        artifact: { artifactId: own.artifactId },
        format: "json",
      });
      const review = JSON.parse(exported.content) as { comments: Comment[] };
      expect(review.comments.map((one) => [one.threadId, one.status])).toEqual([
        [threadId, "open"],
      ]);
    } finally {
      client.close();
    }
  });
});
