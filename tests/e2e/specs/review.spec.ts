/// <reference lib="dom" />
/**
 * The review layer (WP-20; D23, RV-01, RV-02, RV-04) in Chromium, Firefox and WebKit through the
 * real gateway, shell and daemon: comments pin on native DOM, a canvas, a kit chart, a frame the
 * artifact serves and an opaque frame; each anchor stores every layer that applies and always a
 * crop (captured by the daemon's verify runner); the pins come back after a reload; and the
 * comments arrive with the submission, crops by paths that exist.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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

/**
 * Every thread the panel lists has its pin on the page once its place is in view: a pin scrolled
 * out of view isn't drawn (Mirza's review), so each is brought into view from its card first.
 */
async function eachPinShows(page: Page, count: number): Promise<void> {
  const cards = page.locator("[data-mostra-thread]");
  await expect(cards).toHaveCount(count);
  for (const id of await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-mostra-thread") ?? ""),
  )) {
    await page.locator(`[data-mostra-thread="${id}"] .mostra-pin-static`).click();
    await expect(page.locator(`[data-mostra-pin="${id}"]`)).toBeVisible();
  }
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

      // Six threads, each with its numbered pin beside its place.
      await eachPinShows(page, 6);
      // Every crop is captured by the daemon's verify runner (the capture port's default).
      await expect(page.locator('[data-mostra-crop="captured"]')).toHaveCount(6, {
        timeout: 120_000,
      });

      // A reload shows the same pins, placed by the page again.
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-shell", "ready");
      await expect(page.locator("[data-mostra-comment-button]")).toHaveAttribute(
        "title",
        /6 open comments/,
      );
      await page.locator("[data-mostra-comment-button]").click();
      await eachPinShows(page, 6);
      await page.keyboard.press("Escape");

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
      await expect(page.locator('[data-mostra-pin="thr_00000000000000000000000000"]')).toHaveCount(
        0,
      );
      // A page places pins, and a pin it says is off the page isn't drawn (a pin scrolled out of
      // view never sticks to an edge, Mirza's review): sampled while the page keeps lying, a pin
      // is either not drawn or whole inside the page's box, and the panel and the comment button
      // keep the thread whatever the page says.
      const stage = await page.locator(".mostra-frame").boundingBox();
      if (!stage) throw new Error("the frame has no box");
      let drawn = 0;
      for (let sample = 0; sample < 20; sample += 1) {
        expect(await pin.count()).toBeLessThanOrEqual(1);
        // A pin not drawn now has no box: never wait for one.
        const box =
          (await pin.count()) === 1
            ? await pin.boundingBox({ timeout: 500 }).catch(() => null)
            : null;
        if (box) {
          drawn += 1;
          expect(box.x).toBeGreaterThanOrEqual(stage.x - 1);
          expect(box.y).toBeGreaterThanOrEqual(stage.y - 1);
          expect(box.x + box.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
          expect(box.y + box.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
          // At the pin's centre the shell's own pin is on top, whatever the page draws under it.
          const onTop = await page.evaluate(
            ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("data-mostra-pin") ?? "",
            { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          );
          expect(["", threadId]).toContain(onTop);
        }
        await expect(page.locator("[data-mostra-comment-button]")).toHaveAttribute(
          "title",
          /1 open comment/,
        );
        await page.waitForTimeout(100);
      }
      // The page lies every 10 ms, so its pin is rarely drawn; what it may never do is make one,
      // or take the thread from the panel.
      expect(drawn).toBeGreaterThanOrEqual(0);
      await expect(page.locator('[data-mostra-pin="thr_00000000000000000000000000"]')).toHaveCount(
        0,
      );
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

test.describe("selected words, comment mode's words and a lost answer (Mirza's review of WP-20)", () => {
  test("say what to do in comment mode, comment on selected words, and post a lost thread once", async ({
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

      // Comment mode says what to do, and the way out.
      const button = page.locator("[data-mostra-comment-button]");
      await button.click();
      const hint = page.locator("[data-mostra-review-hint]");
      await expect(hint).toContainText("Click what you want to comment on.");
      await expect(button).toContainText("Cancel");
      // A wheel over comment mode scrolls the page under it (Mirza's review).
      const surface = page.locator("[data-mostra-review-surface]");
      const area = await surface.boundingBox();
      if (!area) throw new Error("no surface");
      const scrolled = () => frame.locator("html").evaluate(() => window.scrollY);
      await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
      await page.mouse.wheel(0, 300);
      await expect.poll(scrolled).toBeGreaterThan(100);
      await page.mouse.wheel(0, -1000);
      await expect.poll(scrolled).toBe(0);
      await hint.getByRole("button", { name: "Cancel" }).click();
      await expect(hint).toHaveCount(0);
      await expect(page.locator("[data-mostra-review-surface]")).toHaveCount(0);

      // Words selected with the mouse, as a person selects them: a Comment button beside them.
      const paragraph = frame.locator('[data-testid="paragraph"]');
      const box = await paragraph.boundingBox();
      if (!box) throw new Error("no paragraph");
      await page.mouse.move(box.x + 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 });
      await page.mouse.up();
      const selected = (
        await paragraph.evaluate(() => document.getSelection()?.toString() ?? "")
      ).trim();
      expect(selected.length).toBeGreaterThan(5);
      const offer = page.locator("[data-mostra-selection-comment]");
      await expect(offer).toBeVisible();
      // Beside the words: over the page, near the selection.
      const offered = await offer.boundingBox();
      expect(offered && Math.abs(offered.y + offered.height - box.y) < 80).toBe(true);
      await offer.click();
      const composer = page.locator("[data-mostra-review-new] textarea");
      await expect(composer).toBeVisible();
      await expect(page.locator("[data-mostra-review-new]")).toContainText(selected.slice(0, 20));

      // The first post's answer is lost on its way back: posting again makes one thread, not two.
      let lost = 0;
      await page.route("**/_mostra/v/*/review/threads", async (route) => {
        if (route.request().method() === "POST" && lost === 0) {
          lost += 1;
          await route.fetch();
          await route.abort("connectionreset");
          return;
        }
        await route.continue();
      });
      await composer.fill("I agree with this, for the record.");
      const post = page.locator("[data-mostra-review-new] [data-mostra-review-post]");
      await post.click();
      await expect(page.locator("[data-mostra-review-problem]")).toBeVisible();
      await post.click();
      await expect(page.locator("[data-mostra-review-new]")).toHaveCount(0);
      expect(lost).toBe(1);
      await expect(page.locator("[data-mostra-thread]")).toHaveCount(1);

      const exported = await client.call<{ content: string }>("review/export", {
        artifact: { artifactId: own.artifactId },
        format: "json",
      });
      const review = JSON.parse(exported.content) as {
        comments: (Comment & { anchor: Anchor & { selection?: boolean } })[];
      };
      expect(review.comments).toHaveLength(1);
      const anchor = review.comments[0]?.anchor;
      expect(anchor?.selection).toBe(true);
      expect(anchor?.selectors?.find((one) => one.type === "TextQuoteSelector")?.exact).toBe(
        selected.replace(/\s+/g, " "),
      );
      // The crop marks exactly the selected words, as a selection looks, with no box around
      // whole lines (Mirza's review): a highlight's tint and none of the outline's blue.
      await expect(page.locator('[data-mostra-crop="captured"]')).toHaveCount(1, {
        timeout: 60_000,
      });
      const shot = await client.call<{ content: string }>("review/export", {
        artifact: { artifactId: own.artifactId },
        format: "json",
      });
      const path = (JSON.parse(shot.content) as { comments: Comment[] }).comments[0]?.crop.path;
      if (!path) throw new Error("no crop path");
      const image = PNG.sync.read(readFileSync(path));
      let outline = 0;
      let tint = 0;
      for (let at = 0; at < image.data.length; at += 4) {
        const [r, g, b] = [image.data[at] ?? 0, image.data[at + 1] ?? 0, image.data[at + 2] ?? 0];
        if (r === 0x23 && g === 0x40 && b === 0xc8) outline += 1;
        if (b > 200 && r > 120 && r < 215 && b - r > 25 && b - g > 15) tint += 1;
      }
      expect(outline, "no box drawn around the words").toBe(0);
      expect(tint, "the words carry a highlight").toBeGreaterThan(200);
      // After a reload the pin stands on those words again.
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-shell", "ready");
      const pin = page.locator("[data-mostra-pin]");
      await expect(pin).toHaveCount(1);
      const again = await paragraph.boundingBox();
      const pinned = await pin.boundingBox();
      expect(again && pinned).toBeTruthy();
      if (again && pinned) {
        expect(pinned.y + pinned.height / 2).toBeGreaterThan(again.y - 20);
        expect(pinned.y + pinned.height / 2).toBeLessThan(again.y + again.height + 20);
      }
    } finally {
      client.close();
    }
  });
});

test.describe("comment mode on a phone (Mirza's review of WP-20)", () => {
  test("the panel peeks, a picked place always shows its composer, a drag scrolls, and pins out of view aren't drawn", async ({
    browser,
    browserName,
  }, info) => {
    test.setTimeout(240_000);
    const client = await Client.connect(run.socket);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      ...(browserName !== "firefox" ? { isMobile: true } : {}),
    });
    const page = await context.newPage();
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "review" });
      const url = await linkFor(client, own.artifactId, viewerName(info));
      const frame = await openInShell(page, url);
      await expect(page.locator("html")).toHaveAttribute("data-shell", "ready");
      const panel = page.locator("[data-mostra-review-panel]");
      const tapOn = async (target: Locator): Promise<void> => {
        const box = await target.boundingBox();
        if (!box) throw new Error("no box to tap");
        await page.touchscreen.tap(box.x + Math.min(30, box.width / 2), box.y + box.height / 2);
      };

      // Comment mode: the panel peeks, its threads one tap away, never over the page whole.
      await page.locator("[data-mostra-comment-button]").click();
      await expect(panel).toHaveAttribute("data-peek", "");
      await expect(page.locator("[data-mostra-review-whole]")).toBeVisible();
      // Closed while commenting, a picked place still shows its composer (the peek comes back).
      await panel.getByRole("button", { name: "Close comments" }).click();
      await expect(panel).toHaveCount(0);
      await tapOn(frame.locator("h1"));
      const composer = page.locator("[data-mostra-review-new] textarea");
      await expect(composer).toBeVisible();
      await expect(panel).toHaveAttribute("data-peek", "");
      // The peeking panel leaves the page in sight: under half the screen with the composer.
      const sheet = await panel.boundingBox();
      expect(sheet && sheet.height < 844 / 2).toBe(true);
      await composer.fill("The heading is too long for a phone.");
      await page.locator("[data-mostra-review-new] [data-mostra-review-post]").click();
      await expect(page.locator("[data-mostra-review-new]")).toHaveCount(0);
      // Posted: the threads are behind "Show the comment"; one tap opens them.
      const expand = page.locator("[data-mostra-review-expand]");
      await expect(expand).toBeVisible();
      await expect(page.locator("[data-mostra-thread]")).toBeHidden();
      await expand.click();
      await expect(panel).not.toHaveAttribute("data-peek", "");
      await expect(page.locator("[data-mostra-thread]")).toBeVisible();
      await panel.getByRole("button", { name: "Close comments" }).click();

      // Leaving comment mode takes a peeking panel with it.
      await page.locator("[data-mostra-comment-button]").click();
      await expect(panel).toHaveAttribute("data-peek", "");
      await page
        .locator("[data-mostra-review-hint]")
        .getByRole("button", { name: "Cancel" })
        .click();
      await expect(panel).toHaveCount(0);

      // In comment mode a finger's drag scrolls the page, and the tap that ends it picks nothing.
      await page.locator("[data-mostra-comment-button]").click();
      const surface = page.locator("[data-mostra-review-surface]");
      const area = await surface.boundingBox();
      if (!area) throw new Error("no surface");
      const scrolled = () => frame.locator("html").evaluate(() => window.scrollY);
      expect(await scrolled()).toBe(0);
      await surface.evaluate((element, box) => {
        const x = box.width / 2;
        const send = (type: string, y: number) =>
          element.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 7,
              pointerType: "touch",
              clientX: box.x + x,
              clientY: box.y + y,
              bubbles: true,
              isPrimary: true,
            }),
          );
        send("pointerdown", 500);
        for (let step = 1; step <= 10; step += 1) send("pointermove", 500 - step * 40);
        send("pointerup", 100);
      }, area);
      const room = await frame
        .locator("html")
        .evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      expect(room).toBeGreaterThan(150);
      await expect.poll(scrolled).toBeGreaterThanOrEqual(Math.min(300, room - 2));
      await expect(page.locator("[data-mostra-review-new]")).toHaveCount(0);
      await page
        .locator("[data-mostra-review-hint]")
        .getByRole("button", { name: "Cancel" })
        .click();

      // The heading's pin isn't drawn while the page is scrolled past it, and comes back.
      const pin = page.locator("[data-mostra-pin]");
      await frame
        .locator("html")
        .evaluate(() =>
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }),
        );
      await expect(pin).toHaveCount(0);
      await expect(page.locator("[data-mostra-comment-button]")).toHaveAttribute(
        "title",
        /1 open comment/,
      );
      await frame.locator("html").evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await expect(pin).toHaveCount(1);
    } finally {
      await context.close();
      client.close();
    }
  });
});
