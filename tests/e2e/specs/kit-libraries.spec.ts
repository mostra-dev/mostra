/// <reference lib="dom" />
/**
 * The kit's library wrappers in Chromium, Firefox and WebKit (WP-19):
 * - KT-01: every D26 library the kit wraps draws in this browser: Recharts' four charts, uPlot's
 *   live chart, ECharts, TanStack Table (sorted and searched), Mermaid, React Flow, Shiki, the
 *   CodeMirror editor (its text saved as a field and back after a reload), KaTeX, and, installed
 *   on demand at the kit's pins from the workspace's mirror, MapLibre with deck.gl, a
 *   react-three-fiber scene and Excalidraw (its drawing saved as a field);
 * - KT-04, KT-10: a layer that changes only tokens restyles every one of them;
 * - KT-11: the team's parts render from WP-31's shapes in Studio and in Arcata and take
 *   `className`;
 * - #242: inside a `Page`, a questionnaire's title is a section's and a lone button keeps its width.
 */
import { cpSync } from "node:fs";
import { join } from "node:path";
import { expect, type FrameLocator, type Locator, type Page, test } from "@playwright/test";
import { PNG } from "pngjs";
import {
  E2E_FIXTURES,
  linkFor,
  type OwnArtifact,
  openInShell,
  publishOwn,
  reopenInShell,
  republish,
  results,
  saved,
  viewerName,
} from "../support/client.ts";
import { Client, readRun } from "../support/mostra.ts";

const run = readRun();

/** How long a page with the kit's on-demand libraries may take to come up: several megabytes. */
const HEAVY_READY_MS = 90_000;

/**
 * The share of an element's pixels that are black or nearly: a light page's chart has only its
 * thin text that dark, while a colour a library can't parse paints black (ECharts' heat map did,
 * from colours in CSS's space-separated form).
 */
async function blackShare(locator: Locator): Promise<number> {
  const png = PNG.sync.read(await locator.screenshot({ animations: "disabled" }));
  let black = 0;
  let all = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    all += 1;
    const [r = 0, g = 0, b = 0] = [png.data[index], png.data[index + 1], png.data[index + 2]];
    if (r < 24 && g < 24 && b < 24) black += 1;
  }
  return black / Math.max(1, all);
}

/** How many distinct colours an element shows: a drawn canvas has many, a blank one one or two. */
async function colours(locator: Locator): Promise<number> {
  const png = PNG.sync.read(await locator.screenshot({ animations: "disabled" }));
  const seen = new Set<number>();
  for (let index = 0; index < png.data.length; index += 4 * 7) {
    seen.add(png.data.readUInt32BE(index));
    if (seen.size > 64) break;
  }
  return seen.size;
}

/**
 * Whether the artifact's frame can draw WebGL 2 in this browser, which MapLibre 6 and three.js
 * need: some CI engines offer none, Firefox on Windows' runners WebGL 1 alone.
 */
function webgl(frame: FrameLocator): Promise<boolean> {
  return frame
    .locator("html")
    .evaluate(() => document.createElement("canvas").getContext("webgl2") !== null);
}

test.describe("the kit's library wrappers (KT-01)", () => {
  test("every warm library draws: charts, live chart, ECharts, table, Mermaid, React Flow, code, editor and math", async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "kit-libraries" });
      // ECharts arrives in a chunk of its own after the page, so the page is ready without it.
      const lazy: string[] = [];
      page.on("request", (request) => {
        if (/\/assets\/echarts-[^/]*\.js$/.test(new URL(request.url()).pathname)) {
          lazy.push(request.url());
        }
      });
      const frame = await openInShell(
        page,
        await linkFor(client, own.artifactId, viewerName(info)),
      );

      // Recharts through shadcn's chart part: bars, lines, areas and a donut, each series named.
      const charts = frame.locator("figure[data-slot='chart']");
      await expect(charts).toHaveCount(4);
      await expect(charts.nth(0).locator(".recharts-rectangle")).toHaveCount(12, {
        timeout: 20_000,
      });
      await expect(charts.nth(1).locator(".recharts-line-curve")).toHaveCount(2);
      await expect(charts.nth(2).locator(".recharts-area-area")).toHaveCount(2);
      await expect(charts.nth(3).locator(".recharts-pie-sector")).toHaveCount(2);
      await expect(charts.nth(0)).toContainText("Won");
      await expect(charts.nth(0)).toContainText("Lost");
      // Series take the theme's chart colours in their fixed order (D141).
      const fill = await charts
        .nth(0)
        .locator(".recharts-rectangle")
        .first()
        .evaluate((element) => getComputedStyle(element).fill);
      const chart1 = await frame.locator("html").evaluate((root) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--chart-1)";
        root.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      });
      expect(fill).toBe(chart1);

      // uPlot and ECharts draw on canvases.
      const live = frame.locator("[data-slot='live-chart']");
      await expect(live.locator("canvas")).toHaveCount(1);
      expect(await colours(live.locator("canvas"))).toBeGreaterThan(3);
      await expect(live.locator("[data-slot='live-chart-summary']")).toContainText("400 points");
      const echart = frame.locator("[data-slot='echart']");
      await expect(echart.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
      expect(await colours(echart.locator("canvas").first())).toBeGreaterThan(3);
      // Every ECharts chart on the page, the heat map's cells included, in the theme's colours.
      for (const canvas of await echart.locator("canvas").all()) {
        expect(await blackShare(canvas), "an ECharts canvas painted black").toBeLessThan(0.1);
      }
      expect(lazy.length, "ECharts' own chunk, loaded apart from the page").toBeGreaterThan(0);

      // TanStack Table: four rows, sorted by a header, searched.
      const table = frame.locator("[data-slot='data-table']");
      await expect(table.locator("tbody tr")).toHaveCount(4);
      // A number column sorts largest first, as TanStack Table does, then smallest first.
      const amount = table.getByRole("button", { name: /amount/i });
      await amount.click();
      await expect(table.locator("tbody tr td:first-child")).toHaveText([
        "Acme",
        "Umbrella",
        "Globex",
        "Initech",
      ]);
      await expect(table.locator("th[aria-sort='descending']")).toHaveCount(1);
      await amount.click();
      await expect(table.locator("tbody tr").first()).toContainText("Initech");
      await expect(table.locator("th[aria-sort='ascending']")).toHaveCount(1);
      await table.getByRole("searchbox").fill("Glo");
      await expect(table.locator("tbody tr")).toHaveCount(1);
      await expect(table.locator("tbody tr").first()).toContainText("Globex");

      // Mermaid's diagram and React Flow's graph.
      await expect(frame.locator("[data-slot='mermaid'] svg")).toContainText("Review", {
        timeout: 20_000,
      });
      const flow = frame.locator("[data-slot='flow']");
      await expect(flow.locator(".react-flow__node")).toHaveCount(2);
      await expect(flow.locator(".react-flow__edge")).toHaveCount(1);

      // Shiki colours the code's tokens; KaTeX typesets TeX with MathML for screen readers.
      const code = frame.locator("[data-slot='code'] pre");
      await expect(code).toContainText("retries", { timeout: 20_000 });
      const tints = await code
        .locator("span")
        .evaluateAll((spans) => new Set(spans.map((span) => getComputedStyle(span).color)).size);
      expect(tints).toBeGreaterThan(2);
      await expect(frame.locator("[data-slot='formula'] .katex")).toHaveCount(2);
      await expect(frame.locator("[data-slot='formula'] math").first()).toBeAttached();

      // The editor saves its text as a field: the trusted Submit sends what it shows, the text
      // arrives in results under its label, and the page shows it again after a reload.
      const editor = frame.locator("[data-slot='code-editor'] .cm-content");
      await editor.click();
      await page.keyboard.press("End");
      await page.keyboard.type("  # edited");
      await expect(editor).toContainText("print('hi')  # edited");
      await saved(page);
      await page.locator("#mostra-submit").click();
      await expect(page.locator("#mostra-submit")).toHaveText("Submitted");
      const submitted = JSON.stringify(await results(client, own.artifactId));
      expect(submitted).toContain("print('hi')  # edited");
      expect(submitted).toContain("Your snippet");
      await reopenInShell(page);
      await expect(frame.locator("[data-slot='code-editor'] .cm-content")).toContainText(
        "print('hi')  # edited",
      );
      // The page as it looks, for the review of the kit's design (D68).
      await info.attach("kit-libraries.png", {
        body: await frame.locator("[data-slot='page']").screenshot({ animations: "disabled" }),
        contentType: "image/png",
      });
    } finally {
      client.close();
    }
  });

  test("MapLibre with deck.gl, a react-three-fiber scene and Excalidraw install on demand and draw", async ({
    page,
  }, info) => {
    // The first page with them installs them (from the mirror) and builds them.
    test.setTimeout(600_000);
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "kit-on-demand" });
      const link = await linkFor(client, own.artifactId, viewerName(info));
      const frame = await openInShell(page, link, { readyMs: HEAVY_READY_MS });
      const map = frame.locator("[data-slot='map']");
      const scene = frame.locator("[data-slot='scene']");
      if (await webgl(frame)) {
        // The world outline in the theme, with deck.gl's markers over it.
        await expect(map.locator("canvas").first()).toBeVisible({ timeout: 60_000 });
        await expect
          .poll(() => colours(map.locator(".maplibregl-canvas")), { timeout: 60_000 })
          .toBeGreaterThan(3);
        await expect(scene.locator("canvas")).toBeVisible({ timeout: 60_000 });
        await expect
          .poll(() => colours(scene.locator("canvas")), { timeout: 60_000 })
          .toBeGreaterThan(3);
      } else {
        // A browser without WebGL is told so in words, never a blank box.
        info.annotations.push({ type: "webgl", description: "unavailable in this browser" });
        await expect(map).toContainText("WebGL 2 is turned off or missing");
        await expect(scene).toContainText("WebGL 2 is turned off or missing");
      }
      // Its markers' names are in the page for screen readers.
      await expect(map.locator("li")).toHaveText([/^Berlin/, /^Paris/]);

      // Excalidraw: a drawing is saved as the field and comes back after a reload. A second tab
      // of the same viewer, open before the first draws, shows the first tab's rectangle, and its
      // own stroke adds to it rather than saving over it (Opus review of WP-19, finding 2). The same
      // link opens both, so both tabs share the one session.
      const second = await page.context().newPage();
      const otherFrame = await openInShell(second, link, { readyMs: HEAVY_READY_MS });
      await expect(otherFrame.locator("[data-slot='whiteboard'] .excalidraw")).toBeVisible({
        timeout: 60_000,
      });
      await draw(page, frame, "r");
      await saved(page);
      // The other tab's board takes the saved rectangle: its picture is no longer blank.
      await expect
        .poll(() => colours(otherFrame.locator("[data-slot='whiteboard'] canvas.static")), {
          timeout: 30_000,
        })
        .toBeGreaterThan(1);
      await draw(second, otherFrame, "o");
      await saved(second);
      // The trusted Submit sends the drawing the field holds: both shapes.
      await second.locator("#mostra-submit").click();
      await expect(second.locator("#mostra-submit")).toHaveText("Submitted");
      await second.close();
      const sketch = JSON.stringify(await results(client, own.artifactId));
      expect(sketch).toContain('"type":"rectangle"');
      expect(sketch).toContain('"type":"ellipse"');
      await reopenInShell(page, HEAVY_READY_MS);
      await expect(frame.locator("[data-slot='whiteboard'] .excalidraw")).toBeVisible({
        timeout: 60_000,
      });
      await info.attach("kit-on-demand.png", {
        body: await frame.locator("[data-slot='page']").screenshot({ animations: "disabled" }),
        contentType: "image/png",
      });
    } finally {
      client.close();
    }
  });
});

/** Every visible part (`data-slot`) of a page, cut from one screenshot of its whole frame. */
async function parts(page: Page, frame: FrameLocator): Promise<{ slot: string; png: Buffer }[]> {
  await frame.locator("html").evaluate(() => {
    const style = document.createElement("style");
    style.textContent = "html, body { background: rgb(128, 128, 128) !important; }";
    document.head.append(style);
  });
  const measure = () =>
    frame.locator("[data-slot]").evaluateAll((elements) =>
      elements.flatMap((element) => {
        const box = element.getBoundingClientRect();
        // A visually hidden element (`sr-only`, one pixel square, clipped) is no visible part.
        if (!(box.width > 1 && box.height > 1 && element.checkVisibility())) return [];
        return [
          {
            slot: element.getAttribute("data-slot") ?? "",
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
          },
        ];
      }),
    );
  // Measured on both sides of the screenshot until the page held still across it: a part drawn
  // late (a diagram, a chart loaded on its own) moves what is below it (kit.spec.ts's restyle).
  let boxes = await measure();
  let taken: PNG | undefined;
  for (let attempt = 0; attempt < 10; attempt++) {
    const candidate = PNG.sync.read(
      await page.screenshot({ animations: "disabled", caret: "hide", scale: "css" }),
    );
    const again = await measure();
    if (JSON.stringify(again) === JSON.stringify(boxes)) {
      taken = candidate;
      break;
    }
    boxes = again;
    await page.waitForTimeout(500);
  }
  expect(taken, "the page held still for a screenshot").toBeDefined();
  const shot = taken as PNG;
  const origin = await page.locator("iframe").first().boundingBox();
  return boxes.map((box) => {
    const x = Math.round((origin?.x ?? 0) + box.x);
    const y = Math.round((origin?.y ?? 0) + box.y);
    const width = Math.max(0, Math.min(Math.round(box.width), shot.width - x));
    const height = Math.max(0, Math.min(Math.round(box.height), shot.height - y));
    const rows: Buffer[] = [Buffer.from(`${width}x${height}:`)];
    for (let row = 0; row < height; row++) {
      const start = ((y + row) * shot.width + x) * 4;
      rows.push(shot.data.subarray(start, start + width * 4));
    }
    return { slot: box.slot, png: Buffer.concat(rows) };
  });
}

test.describe("a token change restyles every library wrapper (KT-04, KT-10)", () => {
  for (const fixture of ["kit-libraries", "kit-on-demand"]) {
    test(`every part of ${fixture} looks different under a layer that changes only tokens`, async ({
      browser,
    }, info) => {
      test.setTimeout(600_000);
      const host = await Client.connect(run.socket);
      try {
        const own = await publishOwn(host, run.home, info, { fixture });
        cpSync(join(E2E_FIXTURES, "restyle", "restyle.css"), join(own.dir, "restyle.css"));
        const shots = async (viewer: string) => {
          const context = await browser.newContext({ viewport: { width: 1280, height: 5200 } });
          const page = await context.newPage();
          const frame = await openInShell(page, await linkFor(host, own.artifactId, viewer), {
            readyMs: HEAVY_READY_MS,
          });
          await frame.locator("[data-slot='page']").waitFor();
          // Each library drew: its canvas, diagram or editor is there before the picture.
          await frame
            .locator(
              fixture === "kit-libraries"
                ? "[data-slot='mermaid'] svg, [data-slot='code'] pre"
                : "[data-slot='whiteboard'] .excalidraw",
            )
            .first()
            .waitFor({ timeout: 60_000 });
          await page.waitForTimeout(1500);
          const found = await parts(page, frame);
          await context.close();
          return found;
        };
        const before = await shots(viewerName(info));
        await republish(host, own, (text) =>
          text.replace('kit: { theme: "studio" }', 'kit: { theme: ["studio", "./restyle.css"] }'),
        );
        const after = await shots(viewerName(info, "-restyled"));
        expect(after.map((part) => part.slot)).toEqual(before.map((part) => part.slot));
        const unchanged = before
          .filter((part, index) => part.png.equals(after[index]?.png ?? Buffer.alloc(0)))
          .map((part) => part.slot);
        expect(unchanged).toEqual([]);
      } finally {
        host.close();
      }
    });
  }
});

test.describe("the team's parts (KT-11)", () => {
  for (const theme of ["studio", "arcata"]) {
    test(`render from WP-31's shapes in ${theme} and take className`, async ({ page }, info) => {
      test.setTimeout(180_000);
      const client = await Client.connect(run.socket);
      try {
        const own: OwnArtifact = await publishOwn(client, run.home, info, { fixture: "kit-team" });
        if (theme !== "studio") {
          await republish(client, own, (text) =>
            text.replace('kit: { theme: "studio" }', `kit: { theme: "${theme}" }`),
          );
        }
        const frame = await openInShell(
          page,
          await linkFor(client, own.artifactId, viewerName(info)),
        );
        await expect(frame.locator("html")).toHaveAttribute("data-theme", theme);

        // Presence under each visibility: names, a count, and nothing of others when private.
        const named = frame.getByTestId("presence-names").locator("[data-slot='presence-avatars']");
        await expect(named.locator("li[title]")).toHaveCount(3);
        await expect(named.locator("li[title]").first()).toHaveAttribute("title", "Ada Lovelace");
        // Screen readers hear who: the names, in a sentence.
        await expect(named).toContainText("Ada Lovelace, Grace Hopper");
        await expect(frame.getByTestId("presence-counts")).toContainText("+4");
        await expect(frame.getByTestId("presence-counts")).toContainText(
          "4 other people are here.",
        );
        await expect(frame.getByTestId("presence-private").locator("li")).toHaveCount(0);
        await expect(frame.getByTestId("presence-private")).toContainText("Nobody else is here.");

        // The roster: who answered under names, how many under counts.
        const roster = frame.getByTestId("roster-names");
        await expect(roster).toContainText("2 of 4 answered");
        for (const name of ["You", "Ada Lovelace", "Grace Hopper", "Linus"]) {
          await expect(roster).toContainText(name);
        }
        await expect(frame.getByTestId("roster-counts")).toContainText("3 of 5 answered");

        // Attribution: a person, the viewer, the agent.
        const attribution = frame.getByTestId("attribution");
        await expect(attribution).toContainText("Grace Hopper");
        await expect(attribution).toContainText("4 min ago");
        await expect(attribution).toContainText("You");
        await expect(attribution).toContainText("The agent");

        // Cursors: the two others who share one, by name.
        const cursors = frame.locator("[data-slot='live-cursor']");
        await expect(cursors).toHaveCount(2);
        await expect(cursors.nth(0)).toContainText("Ada Lovelace");

        // className reaches each part: the marked ones wear its red outline.
        const marked = [
          named,
          roster.locator("[data-slot='respondent-tracker']"),
          attribution.locator("[data-slot='attribution']").first(),
          cursors.first(),
        ];
        for (const part of marked) {
          await expect(part).toHaveCSS("outline-color", "rgb(255, 0, 0)");
          await expect(part).toHaveCSS("outline-width", "4px");
        }
        await info.attach(`team-${theme}.png`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      } finally {
        client.close();
      }
    });
  }
});

/**
 * Draws one shape on a page's whiteboard as a person does: Excalidraw's canvas sits under its own
 * layers, so the pointer acts at its place, and the tool is chosen by its key (`r` a rectangle,
 * `o` an ellipse).
 */
async function draw(page: Page, frame: FrameLocator, tool: "r" | "o"): Promise<void> {
  const canvas = frame.locator("[data-slot='whiteboard'] canvas.interactive");
  // The pointer acts where the viewport shows the board, so the board is brought into it.
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const { x, y, width, height } = box ?? { x: 0, y: 0, width: 0, height: 0 };
  // A click on the empty right of the board gives it the keyboard, clear of its menus and of the
  // shapes the other tool draws.
  await page.mouse.click(x + width * 0.85, y + height * 0.85);
  await page.keyboard.press(tool);
  const at = { x: x + width * (tool === "r" ? 0.2 : 0.5), y: y + height * 0.35 };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 120, at.y + 80, { steps: 8 });
  await page.mouse.up();
}

test.describe("a questionnaire and a button inside a Page (#242)", () => {
  for (const theme of ["studio", "arcata"]) {
    test(`the questionnaire's title is a section's and the button keeps its width, in ${theme}`, async ({
      page,
    }, info) => {
      test.setTimeout(180_000);
      const client = await Client.connect(run.socket);
      try {
        const own = await publishOwn(client, run.home, info, { fixture: "kit-page" });
        if (theme !== "studio") {
          await republish(client, own, (text) =>
            text.replace('kit: { theme: "studio" }', `kit: { theme: "${theme}" }`),
          );
        }
        const frame = await openInShell(
          page,
          await linkFor(client, own.artifactId, viewerName(info)),
        );
        await expect(frame.locator("html")).toHaveAttribute("data-theme", theme);
        const size = (locator: Locator) =>
          locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
        const pageTitle = frame.locator("[data-slot='page-header'] h1");
        const sectionTitle = frame.locator("[data-slot='section'] h2").first();
        const questionnaireTitle = frame.locator("[data-slot='questionnaire-header'] h2");
        // One h1, the page's; the questionnaire's title at the section heading's size.
        await expect(frame.locator("h1")).toHaveCount(1);
        await expect(questionnaireTitle).toHaveText("Your answers");
        expect(await size(questionnaireTitle)).toBe(await size(sectionTitle));
        expect(await size(questionnaireTitle)).toBeLessThan(await size(pageTitle));
        // A lone button keeps its own width; the questionnaire still spans the column.
        const column = await frame.locator("[data-slot='page']").evaluate((element) => {
          const style = getComputedStyle(element);
          return (
            element.clientWidth -
            Number.parseFloat(style.paddingLeft) -
            Number.parseFloat(style.paddingRight)
          );
        });
        const button = await frame.getByRole("button", { name: "Send the summary" }).boundingBox();
        expect(button?.width ?? 0).toBeLessThan(column / 2);
        const questionnaire = await frame.locator("[data-slot='questionnaire']").boundingBox();
        expect(Math.round(questionnaire?.width ?? 0)).toBe(Math.round(column));
        // A link placed in the page is a block of it, as before #242 (Opus review of WP-19, 8).
        const card = await frame
          .getByRole("link", { name: "Last quarter's answers" })
          .boundingBox();
        expect(Math.round(card?.width ?? 0)).toBe(Math.round(column));
        await info.attach(`page-${theme}.png`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
      } finally {
        client.close();
      }
    });
  }
});
