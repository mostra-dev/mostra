/// <reference lib="dom" />
/**
 * The review layer on every surface a person meets (WP-20, SH-05, SH-06): on a computer and on a
 * phone (touch), light and dark, in Chromium, Firefox and WebKit: comment mode, the composer, a
 * thread with its crop, a reply, resolving it and the trusted Submit. Each state must pass
 * axe with no serious or critical finding on the shell's own document and never scroll sideways.
 * With `MOSTRA_E2E_SCREENS` set, each state is photographed into that directory, for Mirza's
 * review of the design (D68).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, expect, type Locator, test } from "@playwright/test";
import axe from "axe-core";
import { linkFor, openInShell, publishOwn, viewerName } from "../support/client.ts";
import { Client, readRun } from "../support/mostra.ts";

const run = readRun();
const AXE: string = axe.source;
const SCREENS = process.env["MOSTRA_E2E_SCREENS"];
const MODES = ["light", "dark"] as const;
const SIZES = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
] as const;

for (const mode of MODES) {
  for (const size of SIZES) {
    test(`review, ${mode}, ${size.width} px wide: comment, reply, resolve and submit by ${size.width < 500 ? "touch" : "pointer"}`, async ({
      browser,
      browserName,
    }, info) => {
      test.setTimeout(240_000);
      const phone = size.width < 500;
      const context = await (browser as Browser).newContext({
        viewport: size,
        colorScheme: mode,
        reducedMotion: "reduce",
        ...(phone ? { deviceScaleFactor: 2, hasTouch: true } : {}),
        ...(phone && browserName !== "firefox" ? { isMobile: true } : {}),
      });
      const page = await context.newPage();
      const client = await Client.connect(run.socket);
      const findings: string[] = [];
      /** A press: a tap on a phone, a click on a computer. */
      const press = (target: Locator): Promise<void> => (phone ? target.tap() : target.click());
      /** Checks the shell's document (axe, no sideways scroll) and photographs it when asked. */
      const shoot = async (name: string): Promise<void> => {
        await page.evaluate(() => document.fonts.ready.then(() => true));
        // The trusted controls take no click for 500 ms after they appear or change (SH-02): the
        // checks are of the page a person acts on.
        await page.waitForFunction(
          () =>
            document.querySelector("[data-mostra-trusted]") === null ||
            document.querySelector("[data-mostra-trusted][data-mostra-armed]") !== null,
        );
        // Colours fade between states even with reduced motion: judge and photograph the state a
        // person sees once it settled.
        await page
          .waitForFunction(
            () => document.getAnimations().every((animation) => animation.playState !== "running"),
            undefined,
            { timeout: 3_000 },
          )
          .catch(() => undefined);
        const where = `${browserName} ${mode} ${size.width}px ${name}`;
        const wide = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        if (wide > 1) findings.push(`${where}: scrolls sideways by ${wide}px`);
        await page.evaluate(AXE);
        const violations = await page.evaluate(async () => {
          const engine = (
            window as unknown as {
              axe: {
                run(
                  context: unknown,
                  options: unknown,
                ): Promise<{ violations: { id: string; impact: string; nodes: unknown[] }[] }>;
              };
            }
          ).axe;
          const result = await engine.run(
            { exclude: [["iframe"]] },
            { resultTypes: ["violations"] },
          );
          return result.violations
            .filter((v) => v.impact === "serious" || v.impact === "critical")
            .map((v) => `${v.id} (${v.impact}) at ${JSON.stringify(v.nodes).slice(0, 400)}`);
        });
        for (const violation of violations) findings.push(`${where}: ${violation}`);
        if (SCREENS) {
          const dir = join(SCREENS, browserName, `${mode}-${size.width}`);
          mkdirSync(dir, { recursive: true });
          await page.screenshot({ path: join(dir, `review-${name}.png`) });
        }
      };
      try {
        const own = await publishOwn(client, run.home, info, { fixture: "review" });
        const frame = await openInShell(
          page,
          await linkFor(client, own.artifactId, viewerName(info)),
        );
        await expect(frame.locator("h1")).toBeVisible();
        await shoot("start");

        // Comment mode, then a pin on the heading.
        await press(page.locator("[data-mostra-comment-button]"));
        await expect(page.locator("[data-mostra-review-surface]")).toBeVisible();
        await shoot("mode");
        const box = await frame.locator("h1").boundingBox();
        if (!box) throw new Error("No box for the heading");
        const point = { x: box.x + Math.min(40, box.width / 2), y: box.y + box.height / 2 };
        if (phone) await page.touchscreen.tap(point.x, point.y);
        else await page.mouse.click(point.x, point.y);
        const composer = page.locator("[data-mostra-review-new] textarea");
        await expect(composer).toBeVisible();
        await composer.fill("The heading should say which sidebar this is.");
        await shoot("composer");
        await press(page.locator("[data-mostra-review-new] [data-mostra-review-post]"));
        const thread = page.locator("[data-mostra-thread]", { hasText: "which sidebar" });
        await expect(thread).toBeVisible();
        await expect(thread.locator('[data-mostra-crop="captured"]')).toBeVisible({
          timeout: 60_000,
        });
        await expect(page.locator("[data-mostra-pin]")).toHaveCount(1);
        // The pin stands where the person pointed, not at a corner of the heading's box.
        const pin = await page.locator("[data-mostra-pin]").boundingBox();
        if (!pin) throw new Error("No box for the pin");
        expect(Math.abs(pin.x + pin.width / 2 - point.x)).toBeLessThan(3);
        expect(Math.abs(pin.y + pin.height / 2 - point.y)).toBeLessThan(3);
        await shoot("thread");

        // A reply, then resolving the thread.
        await press(thread.locator("[data-mostra-reply]"));
        const reply = thread.locator("textarea");
        await expect(reply).toBeFocused();
        await reply.fill("Or name it in the bar above it.");
        await press(thread.locator("[data-mostra-review-post]"));
        await expect(thread.locator("[data-mostra-comment]")).toHaveCount(2);
        await shoot("reply");
        await press(thread.locator("[data-mostra-resolve]"));
        await expect(page.locator("[data-mostra-pin]")).toHaveCount(0);
        await shoot("resolved");

        // The trusted Submit by the same hand, never under the comments; the thread arrives with
        // the answers.
        const submitBox = await page.locator("#mostra-submit").boundingBox();
        if (!submitBox) throw new Error("No box for the trusted Submit");
        const onTop = await page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.closest("#mostra-submit") !== null,
          { x: submitBox.x + submitBox.width / 2, y: submitBox.y + submitBox.height / 2 },
        );
        expect(onTop, "the trusted Submit is on top at its centre").toBe(true);
        await page.waitForFunction(
          () => document.querySelector("[data-mostra-trusted][data-mostra-armed]") !== null,
        );
        await press(page.locator("#mostra-submit"));
        await expect(page.locator("[data-mostra-submission]")).toBeVisible({ timeout: 30_000 });
        // The submission closed the draft: its comments can be read, not added to.
        await expect(page.locator("[data-mostra-review-whole]")).toHaveCount(0);
        await expect(page.locator("[data-mostra-review-panel]")).toContainText(
          "comments here can be read but not added",
        );
        await shoot("submitted");
        const results = await client.call<{
          comments: { status: string; messages: unknown[]; crop: { path: string } }[];
        }>("results/get", { artifact: { artifactId: own.artifactId } });
        expect(results.comments).toEqual([
          expect.objectContaining({
            status: "resolved",
            messages: [expect.anything(), expect.anything()],
          }),
        ]);
        expect(findings).toEqual([]);
      } finally {
        client.close();
        await context.close();
      }
    });
  }
}
