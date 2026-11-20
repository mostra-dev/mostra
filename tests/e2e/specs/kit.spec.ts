/// <reference lib="dom" />
/**
 * The kit's questionnaire in Chromium, Firefox and WebKit (WP-18, KT-05): every kind of answer
 * saves through its field as the viewer goes, comes back after a reload, waits for the required
 * answer at the trusted Submit, takes an optional single choice back (#159), and arrives in results
 * under its question's label, each choice by the label the viewer saw, with the recommended option
 * named.
 */
import { expect, test } from "@playwright/test";
import { linkFor, openInShell, publishOwn, results, saved, viewerName } from "../support/client.ts";
import { Client, readRun } from "../support/mostra.ts";

const run = readRun();

test.describe("the page's theme and a host's look (KT-04, D179 item 5)", () => {
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
      host.close();
      // The look is the home's: cleared for the suites after this one.
      const clear = await Client.connect(run.socket, { home: { look: {} } });
      clear.close();
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
