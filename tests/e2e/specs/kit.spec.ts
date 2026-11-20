/// <reference lib="dom" />
/**
 * The kit in Chromium, Firefox and WebKit (WP-18): a page keeps its theme and takes a host's look
 * only where its stack names it (KT-04); a layer of tokens alone restyles every part (KT-04, KT-10);
 * and the questionnaire (KT-05): every kind of answer
 * saves through its field as the viewer goes, comes back after a reload, waits for the required
 * answer at the trusted Submit, takes an optional single choice back (#159), and arrives in results
 * under its question's label, each choice by the label the viewer saw, with the recommended option
 * named.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";
import {
  E2E_FIXTURES,
  linkFor,
  openInShell,
  publishOwn,
  republish,
  results,
  saved,
  viewerName,
} from "../support/client.ts";
import { Client, readRun } from "../support/mostra.ts";

/** The pixels of `box` in `image`, row by row, with its size: two crops are equal only if both are. */
function crop(image: PNG, box: { x: number; y: number; width: number; height: number }): Buffer {
  // Every part shows whole in the one screenshot, or the comparison would miss it.
  expect(box.x >= 0 && box.y >= 0, "a part above or left of the screenshot").toBe(true);
  expect(box.y + box.height, "a part below the screenshot").toBeLessThanOrEqual(image.height);
  const width = Math.max(0, Math.min(box.width, image.width - box.x));
  const height = Math.max(0, Math.min(box.height, image.height - box.y));
  const rows: Buffer[] = [Buffer.from(`${width}x${height}:`)];
  for (let row = 0; row < height; row++) {
    const start = ((box.y + row) * image.width + box.x) * 4;
    rows.push(image.data.subarray(start, start + width * 4));
  }
  return Buffer.concat(rows);
}

const run = readRun();

/** The Agent Skill's specimen: every kit part on one page. */
const SPECIMEN = fileURLToPath(
  new URL("../../../skills/mostra/assets/examples/specimen/", import.meta.url),
);

/** The kit's registry for the Base UI base: what `mostra add` copies. */
const KIT_REGISTRY = fileURLToPath(
  new URL("../../../packages/kit/registry/base/", import.meta.url),
);

test.describe("the page's theme and a host's look (KT-04, D181 item 5)", () => {
  test("a page keeps its theme, takes a host's look where its stack names host, and follows the shell's light or dark", async ({
    page,
  }, info) => {
    // A host embedding Mostra gives its look as MCP Apps' variables (HomeConfig.look); it reaches
    // only pages whose stack names "host", so no other test's page changes.
    const host = await Client.connect(run.socket, {
      home: {
        look: {
          variables: {
            "--color-background-primary": "rgb(10, 20, 30)",
            "--border-radius-md": "14px",
          },
        },
      },
    });
    try {
      const own = await publishOwn(host, run.home, info, { fixture: "themed" });
      const look = async (frame: Awaited<ReturnType<typeof openInShell>>) =>
        frame.locator("html").evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            theme: element.getAttribute("data-theme"),
            appearance: element.getAttribute("data-appearance"),
            background: style.getPropertyValue("--background").trim(),
            radius: style.getPropertyValue("--radius").trim(),
          };
        });
      let frame = await openInShell(page, await linkFor(host, own.artifactId, viewerName(info)));
      // Studio, the default: its own values, not the host's.
      const own1 = await look(frame);
      expect(own1.theme).toBe("studio");
      expect(own1.background).not.toBe("rgb(10, 20, 30)");
      expect(own1.radius).toBe("2px");
      // The shell's switch reaches the page as a host's light or dark.
      const before = own1.appearance;
      await page.locator("[data-mostra-appearance]").click();
      await expect
        .poll(async () => (await look(frame)).appearance)
        .toBe(before === "dark" ? "light" : "dark");
      expect((await look(frame)).background).not.toBe(own1.background);
      // The stack names host: the host's look, over Studio.
      const named = await publishOwn(host, run.home, info, { fixture: "themed-host" });
      frame = await openInShell(
        page,
        await linkFor(host, named.artifactId, viewerName(info, "-2")),
      );
      await expect.poll(async () => (await look(frame)).background).toBe("rgb(10, 20, 30)");
      expect(await look(frame)).toMatchObject({ theme: "studio", radius: "14px" });
    } finally {
      // The look stays: it is the home's, and an engine running beside this one (the seeds run
      // three in one home) sets the same values and may still be reading them. It reaches only
      // pages whose stack names "host" in the shell, which no other test opens there.
      host.close();
    }
  });
});

test.describe("a token change restyles every kit visual (KT-04, KT-10)", () => {
  test("every part of the Skill's specimen looks different under a layer that changes only tokens", async ({
    browser,
  }, info) => {
    test.setTimeout(240_000);
    const host = await Client.connect(run.socket);
    try {
      // The Skill's specimen, every part on one page, published as it is and then with a layer
      // that changes only tokens laid over its theme.
      const dir = join(dirname(run.home), "sources", `restyle-${info.project.name}-${Date.now()}`);
      cpSync(SPECIMEN, dir, { recursive: true });
      cpSync(join(E2E_FIXTURES, "restyle", "restyle.css"), join(dir, "restyle.css"));
      const receipt = await host.call<{ artifactId: string }>("artifact/publish", {
        source: { path: dir },
      });
      const own = { artifactId: receipt.artifactId, dir };
      // Each build in a browser of its own, so neither shows the other's version, tall enough
      // that every part shows at once: one screenshot per build, each part's box cut from it.
      const shots = async (viewer: string): Promise<{ slot: string; png: Buffer }[]> => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 7000 } });
        const page = await context.newPage();
        const frame = await openInShell(page, await linkFor(host, own.artifactId, viewer));
        await frame.locator("[data-slot='page']").waitFor();
        // The page's own ground held the same in both builds: a part whose edges only blend into
        // a changed ground doesn't count as restyled.
        await frame.locator("html").evaluate(() => {
          const style = document.createElement("style");
          style.textContent = "html, body { background: rgb(128, 128, 128) !important; }";
          document.head.append(style);
        });
        // Each visible part, in document order (the same parts in both builds), and its box.
        const boxes = await frame.locator("[data-slot]").evaluateAll((elements) =>
          elements.flatMap((element) => {
            const box = element.getBoundingClientRect();
            if (!(box.width >= 1 && box.height >= 1 && element.checkVisibility())) return [];
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
        const origin = await page.locator("iframe").first().boundingBox();
        expect(origin).not.toBeNull();
        // The frame shows its whole page at this height, so no part is cut off below its edge.
        const view = await frame.locator("html").evaluate(() => ({
          inner: window.innerHeight,
          scroll: document.documentElement.scrollHeight,
        }));
        expect(view.scroll, "the specimen is taller than its frame").toBeLessThanOrEqual(
          view.inner,
        );
        const shot = PNG.sync.read(
          await page.screenshot({ animations: "disabled", caret: "hide", scale: "css" }),
        );
        await context.close();
        return boxes.map((box) => ({
          slot: box.slot,
          png: crop(shot, {
            x: Math.round((origin?.x ?? 0) + box.x),
            y: Math.round((origin?.y ?? 0) + box.y),
            width: Math.round(box.width),
            height: Math.round(box.height),
          }),
        }));
      };
      const before = await shots(viewerName(info));
      await republish(host, own, (text) =>
        text.replace('kit: { theme: "studio" }', 'kit: { theme: ["studio", "./restyle.css"] }'),
      );
      const after = await shots(viewerName(info, "-restyled"));
      expect(after.map((part) => part.slot)).toEqual(before.map((part) => part.slot));
      // The kit's parts on the page: buttons, badges, fields, cards, menus' triggers, tabs, tables,
      // the layout's figures and sections, the questionnaire's questions.
      expect(new Set(before.map((part) => part.slot)).size).toBeGreaterThan(40);
      const unchanged = before
        .filter((part, index) => part.png.equals(after[index]?.png ?? Buffer.alloc(0)))
        .map((part) => part.slot);
      expect(unchanged).toEqual([]);
    } finally {
      host.close();
    }
  });
});

test.describe("design freedom: className and a copied part override the kit (KT-10)", () => {
  test("a className restyles a part, and the artifact's own copy of a part wins over the kit's", async ({
    page,
  }, info) => {
    const host = await Client.connect(run.socket);
    try {
      const dir = join(dirname(run.home), "sources", `override-${info.project.name}-${Date.now()}`);
      cpSync(join(E2E_FIXTURES, "override"), dir, { recursive: true });
      // The kit's own button, copied as `mostra add button` copies it, then edited.
      mkdirSync(join(dir, "components", "ui"), { recursive: true });
      const kitButton = readFileSync(join(KIT_REGISTRY, "components/ui/button.tsx"), "utf8");
      const edited = kitButton.replace('data-slot="button"', 'data-slot="button" data-copy="mine"');
      expect(edited).not.toBe(kitButton);
      writeFileSync(join(dir, "components", "ui", "button.tsx"), edited);
      const receipt = await host.call<{ artifactId: string }>("artifact/publish", {
        source: { path: dir },
      });
      const frame = await openInShell(
        page,
        await linkFor(host, receipt.artifactId, viewerName(info)),
      );
      const card = frame.getByTestId("card");
      await expect(card).toHaveCSS("background-color", "rgb(1, 2, 3)");
      await expect(card).toHaveCSS("color", "rgb(250, 250, 250)");
      // The copy rendered, not the kit's: and the kit's other parts still came from the kit.
      await expect(frame.getByTestId("button")).toHaveAttribute("data-copy", "mine");
      await expect(frame.getByTestId("badge")).toHaveAttribute("data-slot", "badge");
    } finally {
      host.close();
    }
  });
});

test.describe("the kit's questionnaire (KT-05)", () => {
  test("each answer saves through its field, survives a reload and arrives labelled in results", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info, { fixture: "questionnaire" });
      const url = await linkFor(client, own.artifactId, viewerName(info));
      let frame = await openInShell(page, url);

      // The required question holds the trusted Submit back, by its label.
      await page.locator("#mostra-submit").click();
      await expect(page.locator('[data-mostra-blocker="intake.layout"]')).toHaveText(
        "Which layout fits best?",
      );

      await frame.getByRole("radio", { name: /Top bar/ }).check();
      await frame.getByRole("button", { name: "Add a comment" }).click();
      await frame.getByRole("textbox", { name: /Comment on/ }).fill("Wide screens matter most");
      await frame.getByRole("radio", { name: "4" }).check();
      await frame.getByRole("checkbox", { name: /Search/ }).check();
      await frame.getByRole("checkbox", { name: /Something else/ }).check();
      await frame.getByRole("textbox", { name: "Something else" }).fill("Shortcuts");
      await frame.getByRole("button", { name: "Move Pins up" }).click();
      // An optional single choice can be taken back (#159).
      await frame.getByRole("radio", { name: /Design/ }).check();
      await frame.getByRole("button", { name: /Clear my answer/ }).click();
      await expect(frame.getByRole("radio", { name: /Design/ })).not.toBeChecked();
      await frame.getByRole("textbox", { name: "Anything else?" }).fill("Ship it before March");
      await expect(frame.getByText("5 of 6 answered")).toBeVisible();
      await saved(page);

      // Everything comes back from the draft.
      await page.reload();
      frame = await openInShell(page, page.url());
      await expect(frame.getByRole("radio", { name: /Top bar/ })).toBeChecked();
      await expect(frame.getByRole("radio", { name: "4" })).toBeChecked();
      await expect(frame.getByRole("checkbox", { name: /Something else/ })).toBeChecked();
      await expect(frame.getByRole("textbox", { name: "Something else" })).toHaveValue("Shortcuts");
      await expect(frame.getByRole("textbox", { name: /Comment on/ })).toHaveValue(
        "Wide screens matter most",
      );
      await expect(frame.locator('[data-slot="rank-item"]')).toHaveText([
        /Search/,
        /Pins/,
        /Recents/,
      ]);

      await page.locator("#mostra-submit").click();
      await expect(page.locator("#mostra-submit")).toHaveText("Submitted");

      const json = (await results(client, own.artifactId)) as {
        answers: { intake: Record<string, unknown> };
        fields: { id: string; label?: string; options?: unknown[] }[];
      };
      expect(json.answers.intake).toMatchObject({
        layout: "top",
        "layout.comment": "Wide screens matter most",
        density: 4,
        extras: ["search", "other"],
        "extras.other": "Shortcuts",
        order: ["Search", "Pins", "Recents"],
        team: "",
        notes: "Ship it before March",
      });
      const layout = json.fields.find((field) => field.id === "intake.layout");
      expect(layout).toMatchObject({
        label: "Which layout fits best?",
        options: [
          { value: "left", label: "Left rail", recommended: true },
          { value: "top", label: "Top bar" },
        ],
      });
      const { markdown } = await client.call<{ markdown: string }>("results/get", {
        artifact: { artifactId: own.artifactId },
        format: "md",
      });
      expect(markdown).toContain(
        '"Which layout fits best?" (`intake.layout`): "Top bar" (`"top"`), not the recommended "Left rail"',
      );
      expect(markdown).toContain(
        '"Which layout fits best?: comment" (`intake.layout.comment`): "Wide screens matter most"',
      );
      expect(markdown).toContain(
        '"Which sections should it show?" (`intake.extras`): "Search" (`"search"`), "Something else" (`"other"`), not the recommended "Recents"',
      );
      expect(markdown).toContain(
        '"Which sections should it show?: Something else" (`intake.extras.other`): "Shortcuts"',
      );
      expect(markdown).toContain('"How dense should it be?" (`intake.density`): "4" (`4`)');
      expect(markdown).toContain('"Who reviews it first?" (`intake.team`): no answer');
    } finally {
      client.close();
    }
  });
});
