/// <reference lib="dom" />
/**
 * The review layer (WP-20; D23, RV-01, RV-02, RV-04) in Chromium, Firefox and WebKit through the
 * real gateway, shell and daemon: comments pin on native DOM, a canvas, a kit chart, a frame the
 * artifact serves and an opaque frame; each anchor stores every layer that applies and always a
 * crop (captured by the daemon's verify runner); the pins come back after a reload; and the
 * comments arrive with the submission, crops by paths that exist.
 */
import { existsSync } from "node:fs";
import { expect, type FrameLocator, type Locator, type Page, test } from "@playwright/test";
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
  const box = await target.boundingBox();
  if (!box) throw new Error(`No box for ${text}`);
  await page.locator("[data-mostra-comment-button]").click();
  await expect(page.locator("[data-mostra-review-surface]")).toBeVisible();
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
      await comment(page, frame.locator('[data-testid="opaque"]'), "What is this page?");

      // Five pins, numbered, each beside its place.
      await expect(page.locator("[data-mostra-pin]")).toHaveCount(5);
      // Every crop is captured by the daemon's verify runner (the capture port's default).
      await expect(page.locator('[data-mostra-crop="captured"]')).toHaveCount(5, {
        timeout: 120_000,
      });

      // A reload shows the same pins, placed by the page again.
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-shell", "ready");
      await expect(page.locator("[data-mostra-pin]")).toHaveCount(5);

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
      const opaque = byText("What is this page?");
      expect(opaque.anchor.frames?.[0]?.served).toBe(false);

      // Submitted, the comments arrive with the answers (RV-03's comment half).
      await page.locator("#mostra-submit").click();
      await expect(page.locator("[data-mostra-status]")).toHaveAttribute(
        "data-mostra-status",
        "sent",
      );
      const results = await client.call<{ comments: Comment[] }>("results/get", {
        artifact: { artifactId: own.artifactId },
      });
      expect(results.comments).toHaveLength(5);
      for (const entry of results.comments) expect(existsSync(entry.crop.path)).toBe(true);
    } finally {
      client.close();
    }
  });
});
