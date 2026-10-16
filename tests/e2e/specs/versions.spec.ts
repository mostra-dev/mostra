/// <reference lib="dom" />
/**
 * Versions in open views, in Chromium, Firefox and WebKit (WP-07): a publish shows the banner in
 * an open view without a reload, and switching is the viewer's choice (VR-04); answers a newer
 * version has no field for stay as orphans, read-only in the "Not carried over" panel and in the
 * submission's `orphaned` section (VR-05); "Always follow this artifact" switches by itself
 * unless unsaved edits or orphans would result (LL-03); a submit from an older version's view is
 * flagged (H-10); and a frame another tab moved to another version is loaded again at its own
 * (D98 item 5).
 */
import { expect, type Page, test } from "@playwright/test";
import {
  linkFor,
  type OwnArtifact,
  openInShell,
  publishOwn,
  republish,
  results,
  saved,
  viewerName,
} from "../support/client.ts";
import { Client, readRun } from "../support/mostra.ts";

const run = readRun();

// Every test here publishes a version and then at least one more: each is a real build, which a
// busy machine running three engines in parallel takes many seconds over. A test's time budget
// covers its builds; the waits inside it stay strict.
test.slow();

/** A version whose page has no "notes" field any more: an answer to it can't carry over. */
const withoutNotes = (text: string): string =>
  text
    .replace(
      'const [notes, setNotes, notesMeta] = useField("notes", "", { label: "Notes" });',
      'const [notes, setNotes] = useState(""); const notesMeta = { save: "saved" };',
    )
    .replace("Client runtime fixture", "Client runtime fixture, without notes");

/** A version that changes only its text: every answer carries over. */
const retitled =
  (n: number) =>
  (text: string): string =>
    text.replace(/title: "Client runtime fixture[^"]*"/, `title: "Client runtime fixture ${n}"`);

/** The version number the page itself reports (`useArtifact`). */
function pageVersion(page: Page) {
  return page.frameLocator("iframe.mostra-frame").getByTestId("version");
}

async function open(
  client: Client,
  page: Page,
  own: OwnArtifact,
  viewer: string,
): Promise<ReturnType<Page["frameLocator"]>> {
  return openInShell(page, await linkFor(client, own.artifactId, viewer));
}

test.describe("a newer version in an open view (VR-04)", () => {
  test("the banner appears after a publish without a reload, and the view switches only when the viewer chooses", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      const frame = await open(client, page, own, viewerName(info));
      await frame.getByTestId("name").fill("Ana");
      await saved(page);
      await expect(page.locator("[data-mostra-banner]")).toHaveCount(0);
      // The shell hears the publish on its own stream: one event, no reload.
      const navigations: string[] = [];
      page.on("framenavigated", (frame) => navigations.push(frame.url()));
      await republish(client, own, retitled(2));
      await expect(page.locator('[data-mostra-banner="2"]')).toBeVisible({ timeout: 10_000 });
      expect(navigations).toEqual([]);
      // Not following: the view stays on its version until the viewer switches.
      await page.waitForTimeout(1_500);
      await expect(pageVersion(page)).toHaveText("1");
      const entries = await page.evaluate((): number => window.history.length);
      await page.locator("[data-mostra-switch]").click();
      await expect(pageVersion(page)).toHaveText("2", { timeout: 15_000 });
      await expect(page.locator("[data-mostra-banner]")).toHaveCount(0);
      // The switch is a new frame, not a navigation of the old one: it adds nothing to the tab's
      // history, so Back never takes the frame to a spent ticket.
      expect(await page.evaluate((): number => window.history.length)).toBe(entries);
      // The answer carried over by its field ID.
      await expect(page.frameLocator("iframe.mostra-frame").getByTestId("name")).toHaveValue("Ana");
    } finally {
      client.close();
    }
  });
});

test.describe("answers that don't carry over (VR-05)", () => {
  test("the panel follows the draft: an older version's tab changing the answer shows at once (GPT review finding 15)", async ({
    page,
    browser,
  }, info) => {
    const client = await Client.connect(run.socket);
    const other = await browser.newContext();
    try {
      const own = await publishOwn(client, run.home, info);
      const viewer = viewerName(info);
      const frame = await open(client, page, own, viewer);
      await frame.getByTestId("notes").fill("first");
      await saved(page);
      await republish(client, own, withoutNotes);
      await expect(page.locator('[data-mostra-banner-orphans="1"]')).toBeVisible({
        timeout: 10_000,
      });
      await page.locator("[data-mostra-switch]").click();
      await expect(pageVersion(page)).toHaveText("2", { timeout: 15_000 });
      const orphan = page.locator("[data-mostra-orphan=notes]");
      await expect(orphan).toContainText("first");
      // The same viewer, on another device, with a link to version 1, which still has the field.
      const pinned = await client.call<{ url: string }>("view/url", {
        artifact: { artifactId: own.artifactId },
        version: 1,
        viewer: { ref: viewer, name: viewer },
      });
      const second = await other.newPage();
      const oldFrame = await openInShell(second, pinned.url);
      await oldFrame.getByTestId("notes").fill("changed on version 1");
      await saved(second);
      await expect(orphan).toContainText("changed on version 1", { timeout: 10_000 });
    } finally {
      await other.close();
      client.close();
    }
  });

  test("the banner counts them, the panel shows them read-only after the switch, and the submission delivers them as orphaned", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      const frame = await open(client, page, own, viewerName(info));
      await frame.getByTestId("name").fill("Ana");
      await frame.getByTestId("notes").fill("a note for version 1");
      await saved(page);
      await republish(client, own, withoutNotes);
      await expect(page.locator('[data-mostra-banner-orphans="1"]')).toBeVisible({
        timeout: 10_000,
      });
      await page.locator("[data-mostra-switch]").click();
      await expect(pageVersion(page)).toHaveText("2", { timeout: 15_000 });
      const panel = page.locator('[data-mostra-orphans="1"]');
      await expect(panel).toBeVisible();
      const orphan = panel.locator("[data-mostra-orphan=notes]");
      await expect(orphan).toContainText("Notes");
      await expect(orphan).toContainText("a note for version 1");
      await expect(orphan).toContainText("From version 1");
      // Read-only: the panel offers nothing to edit, only to copy.
      await expect(orphan.locator("input, textarea, [contenteditable=true]")).toHaveCount(0);
      await page.locator("#mostra-submit").click();
      await expect(page.locator("#mostra-submit")).toHaveText("Submitted");
      const done = (await results(client, own.artifactId)) as {
        submission: { version: number };
        answers: Record<string, unknown>;
        orphaned: { id: string; label?: string; value: unknown; fromVersion: number }[];
      };
      expect(done.submission.version).toBe(2);
      expect(done.answers).toMatchObject({ name: "Ana" });
      expect(done.answers).not.toHaveProperty("notes");
      expect(done.orphaned).toEqual([
        { id: "notes", label: "Notes", value: "a note for version 1", fromVersion: 1 },
      ]);
      const markdown = await client.call<{ markdown: string }>("results/get", {
        artifact: { artifactId: own.artifactId },
        format: "md",
      });
      expect(markdown.markdown).toMatch(/Not carried over[\s\S]*a note for version 1/);
    } finally {
      client.close();
    }
  });
});

test.describe("always follow this artifact (LL-03)", () => {
  test("a following viewer gets new versions by themselves, but not over unsaved edits or orphans", async ({
    page,
  }, info) => {
    test.setTimeout(90_000);
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      const viewer = viewerName(info);
      const frame = await open(client, page, own, viewer);
      await frame.getByTestId("name").fill("Ana");
      await saved(page);
      await republish(client, own, retitled(2));
      await page.locator("[data-mostra-follow=off]").click();
      await expect(pageVersion(page)).toHaveText("2", { timeout: 15_000 });
      // Following is the viewer's choice for this artifact, kept across reloads.
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-shell", "ready", {
        timeout: 20_000,
      });
      await expect(page.locator(".mostra-following[data-mostra-follow=on]")).toBeVisible();
      // A version with nothing unsaved and nothing orphaned loads by itself.
      await republish(client, own, retitled(3));
      await expect(pageVersion(page)).toHaveText("3", { timeout: 15_000 });
      // An unsaved edit holds the switch until it is saved.
      await page.route("**/_mostra/v/*/fields", (route) => route.abort());
      await page.frameLocator("iframe.mostra-frame").getByTestId("color").fill("blue");
      await expect(page.locator("[data-mostra-save]")).not.toHaveAttribute(
        "data-mostra-save",
        "saved",
      );
      await republish(client, own, retitled(4));
      await expect(page.locator('[data-mostra-banner="4"]')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-mostra-banner="4"]')).toContainText("aren't saved");
      await page.waitForTimeout(1_500);
      await expect(pageVersion(page)).toHaveText("3");
      await page.unroute("**/_mostra/v/*/fields");
      await expect(pageVersion(page)).toHaveText("4", { timeout: 20_000 });
      await expect(page.frameLocator("iframe.mostra-frame").getByTestId("color")).toHaveValue(
        "blue",
      );
      // The viewer was typing in the frame the switch replaced: its successor has the focus, so
      // the next keys land in the artifact, not on the shell's page.
      await expect(page.locator("iframe.mostra-frame")).toBeFocused();
      // A version that would orphan an answer waits for the viewer, with the banner's count.
      await page.frameLocator("iframe.mostra-frame").getByTestId("notes").fill("only in 4");
      await saved(page);
      await republish(client, own, withoutNotes);
      await expect(page.locator('[data-mostra-banner-orphans="1"]')).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.locator("[data-mostra-banner]")).toContainText("wouldn't carry over");
      await page.waitForTimeout(1_500);
      await expect(pageVersion(page)).toHaveText("4");
      // The viewer switches anyway; the answer stays in the panel. An answer already not carried
      // over doesn't hold the next version back: following goes on by itself.
      await page.locator("[data-mostra-switch]").click();
      await expect(pageVersion(page)).toHaveText("5", { timeout: 15_000 });
      await expect(page.locator("[data-mostra-orphan=notes]")).toBeVisible();
      await republish(client, own, (text) => retitled(6)(withoutNotes(text)));
      await expect(pageVersion(page)).toHaveText("6", { timeout: 15_000 });
      await expect(page.locator("[data-mostra-orphan=notes]")).toBeVisible();
    } finally {
      client.close();
    }
  });
});

test.describe("stale views and other tabs", () => {
  test("a submit from an older version's view is accepted and flagged with the newer version", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      const frame = await open(client, page, own, viewerName(info));
      await frame.getByTestId("name").fill("Ana");
      await saved(page);
      await republish(client, own, retitled(2));
      await expect(page.locator('[data-mostra-banner="2"]')).toBeVisible({ timeout: 10_000 });
      await page.locator("#mostra-submit").click();
      await expect(page.locator("#mostra-submit")).toHaveText("Submitted");
      const done = (await results(client, own.artifactId)) as {
        submission: { version: number; staleView: boolean; latestVersion?: number };
      };
      expect(done.submission).toMatchObject({ version: 1, staleView: true, latestVersion: 2 });
    } finally {
      client.close();
    }
  });

  test("a frame reloaded after another tab switched versions is loaded again at its own version", async ({
    context,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      const url = await linkFor(client, own.artifactId, viewerName(info));
      const older = await context.newPage();
      await openInShell(older, url);
      await republish(client, own, retitled(2));
      const newer = await context.newPage();
      await openInShell(newer, url);
      await expect(pageVersion(newer)).toHaveText("2");
      // The artifact origin now serves version 2 to this browser; the older tab's frame reloads.
      await expect(pageVersion(older)).toHaveText("1");
      const frame = older.frames().find((candidate) => candidate !== older.mainFrame());
      await frame?.evaluate(() => location.reload());
      await expect(older.locator("html")).toHaveAttribute("data-frame-reentries", "1", {
        timeout: 15_000,
      });
      await expect(pageVersion(older)).toHaveText("1", { timeout: 15_000 });
      // A save from it is a save of its own view, of version 1.
      await older
        .frameLocator("iframe.mostra-frame")
        .getByTestId("name")
        .fill("from the older tab");
      await saved(older);
      await older.locator("#mostra-submit").click();
      await expect(older.locator("#mostra-submit")).toHaveText("Submitted");
      const done = (await results(client, own.artifactId)) as {
        submission: { version: number };
        answers: Record<string, unknown>;
      };
      expect(done.submission.version).toBe(1);
      expect(done.answers).toMatchObject({ name: "from the older tab" });
    } finally {
      client.close();
    }
  });
});
