/// <reference lib="dom" />
/**
 * The client runtime and the shell's trusted controls in Chromium, Firefox and WebKit through
 * the real gateway (WP-07): fields save and survive a closed tab (IN-02), tabs and devices
 * converge or conflict (IN-03), offline edits replay (IN-04), and the trusted Submit records the
 * shell channel with its delivery states (IN-13, SH-02).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, firefox, test, webkit } from "@playwright/test";
import {
  linkFor,
  openInShell,
  publishOwn,
  republish,
  results,
  saved,
  viewerName,
  watchTyping,
} from "../support/client.ts";
import { Client, readRun, removeTree, startDaemon } from "../support/mostra.ts";

const run = readRun();

test.describe("fields and the trusted Submit", () => {
  test("a field saves as the viewer types, survives a reload, and the trusted Submit sends it on the shell channel", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      const viewer = viewerName(info);
      const url = await linkFor(client, own.artifactId, viewer);
      const frame = await openInShell(page, url);
      await expect(page.locator("#mostra-submit")).toHaveText("Send answers");
      await frame.getByTestId("name").fill("Ana");
      await saved(page);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-shell", "ready", {
        timeout: 20_000,
      });
      const again = page.frameLocator("iframe.mostra-frame");
      await expect(again.getByTestId("name")).toHaveValue("Ana");
      await page.locator("#mostra-submit").click();
      await expect(page.locator("[data-mostra-receipt]")).toBeVisible();
      await expect(page.locator("#mostra-submit")).toHaveText("Submitted");
      const submitted = (await results(client, own.artifactId)) as {
        submission: { channel: string; viewer: { name?: string } };
        answers: Record<string, unknown>;
      };
      expect(submitted.submission.channel).toBe("shell");
      expect(submitted.submission.viewer.name).toBe(viewer);
      // The default the viewer saw is in the submission too (D110).
      expect(submitted.answers).toMatchObject({ name: "Ana", color: "red" });
      await expect(again.getByTestId("submit-state")).toHaveText(/submitted|delivered/);
    } finally {
      client.close();
    }
  });
});

/** The page's draft as a fresh browser context (another device) sees it. */
async function valueElsewhere(
  browser: import("@playwright/test").Browser,
  url: string,
  testId: string,
): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const frame = await openInShell(page, url);
    await saved(page);
    return await frame.getByTestId(testId).inputValue();
  } finally {
    await context.close();
  }
}

test.describe("a frame whose first handshake fails (Claude review finding 4)", () => {
  test("connects when it can, saving to Mostra, and the shell says Connecting until then", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      // The frame's first two session reads fail, as during a daemon restart. The handler then
      // removes itself before it refuses the second, so the third read and everything after it
      // reach the gateway untouched: a request this interception let through instead
      // (`route.continue`) hung in Firefox on Windows until the page gave it up after 10 s, read
      // after read, and the shell never got ready (the trace of CI run 40257246209; the same
      // timeout at this test's `ready` in runs 40119528647 and 40112700618; MT-02). The predicate
      // matches the frame's read only, not the shell's `/a/…/_mostra/session`.
      let failures = 0;
      const sessionRead = (url: URL): boolean => url.pathname === "/_mostra/session";
      const failTwice = async (route: import("@playwright/test").Route): Promise<void> => {
        failures += 1;
        // Refused first: removing the handler hands a request it still holds back to Playwright.
        await route.abort("connectionrefused");
        if (failures >= 2) await page.unroute(sessionRead, failTwice);
      };
      await page.route(sessionRead, failTwice);
      await page.goto(await linkFor(client, own.artifactId, viewerName(info)));
      await expect(page.locator("[data-mostra-save]")).toHaveAttribute(
        "data-mostra-save",
        "connecting",
      );
      await expect(page.locator("html")).toHaveAttribute("data-shell", "ready", {
        timeout: 20_000,
      });
      // The failures are over: nothing else goes through the test's interception, which once
      // held a save's POST until the test ended (Firefox on Windows, WP-W2).
      await page.unrouteAll({ behavior: "wait" });
      const frame = page.frameLocator("iframe.mostra-frame");
      await expect(frame.getByTestId("mode")).toHaveText("live");
      // WebKit once left the name empty after its fill, and the shell rightly refused the Submit
      // (#85): this fails at the field, with what each document saw of the typing.
      const typing = await watchTyping(page, frame);
      await frame.getByTestId("notes").fill("after a failed start");
      await frame.getByTestId("name").fill("Ana");
      await typing.typed("notes", "after a failed start");
      await typing.typed("name", "Ana");
      await saved(page);
      await page.locator("#mostra-submit").click();
      await expect(page.locator("#mostra-submit")).toHaveText("Submitted");
      const done = (await results(client, own.artifactId)) as { answers: Record<string, unknown> };
      expect(done.answers).toMatchObject({ notes: "after a failed start" });
      expect(failures).toBe(2);
    } finally {
      client.close();
    }
  });
});

test.describe("a closed tab loses nothing (IN-02)", () => {
  test("an edit still inside the debounce is sent when the tab closes (visibilitychange, pagehide)", async ({
    browser,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      const url = await linkFor(client, own.artifactId, viewerName(info));
      const context = await browser.newContext();
      const page = await context.newPage();
      const frame = await openInShell(page, url);
      await frame.getByTestId("notes").fill("typed just before closing");
      await page.close({ runBeforeUnload: true });
      // Another device has no journal of this one: the value reached Mostra itself.
      await expect
        .poll(() => valueElsewhere(browser, url, "notes"), { timeout: 15_000 })
        .toBe("typed just before closing");
      await context.close();
    } finally {
      client.close();
    }
  });

  test("an edit the tab couldn't send is journaled and sent when the browser opens the artifact again", async ({
    browserName,
  }, info) => {
    test.setTimeout(120_000);
    // A daemon of this test's own, so Mostra can be made unreachable and come back on the same
    // home and ports (D62), and a browser profile of its own that outlives the browser.
    let daemon = await startDaemon();
    let client = await Client.connect(daemon.socket);
    const profile = mkdtempSync(join(tmpdir(), "mostra-e2e-profile-"));
    const stop = async (): Promise<void> => {
      client.close();
      daemon.child.kill("SIGTERM");
      await new Promise((resolve) => daemon.child.once("exit", resolve));
    };
    try {
      const own = await publishOwn(client, daemon.home, info);
      const url = await linkFor(client, own.artifactId, viewerName(info));
      const engine = { chromium, firefox, webkit }[browserName];
      // Another device, to see what Mostra itself holds.
      const browser = await engine.launch();
      const first = await engine.launchPersistentContext(profile);
      const page = first.pages()[0] ?? (await first.newPage());
      const frame = await openInShell(page, url);
      await stop();
      // Mostra is gone: the edit can't be saved, not even as the browser closes.
      await frame.getByTestId("notes").fill("kept in the journal");
      await frame.getByTestId("notes").blur();
      await expect(frame.getByTestId("notes-save")).toHaveText("offline");
      await first.close();
      daemon = await startDaemon({ root: daemon.root });
      client = await Client.connect(daemon.socket);
      expect(await valueElsewhere(browser, url, "notes")).toBe("");
      // The browser opens the artifact again: the page replays the journal it left.
      const second = await engine.launchPersistentContext(profile);
      const next = second.pages()[0] ?? (await second.newPage());
      const again = await openInShell(next, url);
      await expect(again.getByTestId("notes")).toHaveValue("kept in the journal");
      await saved(next);
      expect(await valueElsewhere(browser, url, "notes")).toBe("kept in the journal");
      await second.close();
      await browser.close();
    } finally {
      await stop();
      removeTree(daemon.root);
      rmSync(profile, { recursive: true, force: true });
    }
  });
});

test.describe("tabs and devices converge (IN-03)", () => {
  test("two tabs and two devices editing different fields converge through the event stream", async ({
    browser,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      const url = await linkFor(client, own.artifactId, viewerName(info));
      const laptop = await browser.newContext();
      const phone = await browser.newContext();
      const [one, two] = [await laptop.newPage(), await laptop.newPage()];
      const three = await phone.newPage();
      const frames = [
        await openInShell(one, url),
        await openInShell(two, url),
        await openInShell(three, url),
      ];
      await frames[0]?.getByTestId("name").fill("from tab one");
      await frames[1]?.getByTestId("color").fill("from tab two");
      await frames[2]?.getByTestId("notes").fill("from the phone");
      for (const frame of frames) {
        await expect(frame.getByTestId("name")).toHaveValue("from tab one");
        await expect(frame.getByTestId("color")).toHaveValue("from tab two");
        await expect(frame.getByTestId("notes")).toHaveValue("from the phone");
      }
      for (const page of [one, two, three]) await saved(page);
      await laptop.close();
      await phone.close();
    } finally {
      client.close();
    }
  });

  test("one field edited in two places surfaces a conflict with both values, and keeping mine wins everywhere", async ({
    browser,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      const url = await linkFor(client, own.artifactId, viewerName(info));
      const laptop = await browser.newContext();
      const phone = await browser.newContext();
      const mine = await laptop.newPage();
      const theirs = await phone.newPage();
      const myFrame = await openInShell(mine, url);
      const theirFrame = await openInShell(theirs, url);
      // My laptop loses the network while the phone saves the same field; when it comes back,
      // the browser says so (`online`) and the page sends what it kept. A request refused by a
      // route instead left the page in its retry backoff, which grows while the phone saves: on
      // a slower machine (Windows' legs, WP-W2) the next retry came after the test's wait.
      await laptop.setOffline(true);
      await myFrame.getByTestId("name").fill("mine");
      await expect(myFrame.getByTestId("name-save")).toHaveText("offline");
      await theirFrame.getByTestId("name").fill("theirs");
      await saved(theirs);
      await laptop.setOffline(false);
      await expect(myFrame.getByTestId("name-conflict")).toBeVisible({ timeout: 15_000 });
      await expect(myFrame.getByTestId("name-theirs")).toHaveText("theirs");
      await expect(myFrame.getByTestId("name")).toHaveValue("mine");
      await expect(mine.locator("[data-mostra-save]")).toHaveAttribute(
        "data-mostra-save",
        "conflict",
      );
      await myFrame.getByTestId("name-keep").click();
      await saved(mine);
      await expect(theirFrame.getByTestId("name")).toHaveValue("mine");
      await expect(myFrame.getByTestId("name-conflict")).toHaveCount(0);
      await laptop.close();
      await phone.close();
    } finally {
      client.close();
    }
  });
});

test.describe("offline edits (IN-04)", () => {
  test("edits made offline are journaled and replay in order when the page is back", async ({
    page,
  }, info) => {
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      const url = await linkFor(client, own.artifactId, viewerName(info));
      const frame = await openInShell(page, url);
      const sent: string[] = [];
      page.on("request", (request) => {
        if (request.url().endsWith("/fields") && request.method() === "POST") {
          const ops = (request.postDataJSON() as { ops: { id: string; value: unknown }[] }).ops;
          sent.push(ops.map((op) => `${op.id}=${String(op.value)}`).join("+"));
        }
      });
      await page.route("**/_mostra/v/*/fields", (route) => route.abort());
      await frame.getByTestId("name").fill("first");
      await frame.getByTestId("name").blur();
      await frame.getByTestId("color").fill("second");
      await frame.getByTestId("color").blur();
      await frame.getByTestId("name").fill("third");
      await frame.getByTestId("name").blur();
      await expect(frame.getByTestId("name-save")).toHaveText("offline");
      sent.length = 0;
      await page.unroute("**/_mostra/v/*/fields");
      await saved(page);
      // Each mutation went once, in the order it was made; the newest value of a field won.
      const first = sent.findIndex((ops) => ops.includes("name=first"));
      const second = sent.findIndex((ops) => ops.includes("color=second"));
      const third = sent.findIndex((ops) => ops.includes("name=third"));
      expect(first).toBeGreaterThanOrEqual(0);
      expect(second).toBeGreaterThan(first);
      expect(third).toBeGreaterThan(second);
      await page.reload();
      const again = page.frameLocator("iframe.mostra-frame");
      await expect(again.getByTestId("name")).toHaveValue("third");
      await expect(again.getByTestId("color")).toHaveValue("second");
    } finally {
      client.close();
    }
  });

  test("edits made offline against a version since replaced replay as that version's, then map by ID or become orphans", async ({
    page,
  }, info) => {
    // Two publishes, each a real build (see versions.spec.ts).
    test.slow();
    const client = await Client.connect(run.socket);
    try {
      const own = await publishOwn(client, run.home, info);
      const frame = await openInShell(
        page,
        await linkFor(client, own.artifactId, viewerName(info)),
      );
      await page.route("**/_mostra/v/*/fields", (route) => route.abort());
      await frame.getByTestId("name").fill("Ana offline");
      await frame.getByTestId("notes").fill("a note for version 1");
      await frame.getByTestId("notes").blur();
      await expect(frame.getByTestId("notes-save")).toHaveText("offline");
      // Version 2 has no "notes" field; it is published while the edits wait.
      await republish(client, own, (text) =>
        text.replace(
          'const [notes, setNotes, notesMeta] = useField("notes", "", { label: "Notes" });',
          'const [notes, setNotes] = useState(""); const notesMeta = { save: "saved" };',
        ),
      );
      await expect(page.locator('[data-mostra-banner="2"]')).toBeVisible({ timeout: 10_000 });
      // Back online: the journal replays as version 1's view, which had both fields.
      await page.unroute("**/_mostra/v/*/fields");
      await saved(page);
      // Switching maps "name" by its ID; "notes" is kept as an orphan, never mapped by position.
      await expect(page.locator('[data-mostra-banner-orphans="1"]')).toBeVisible();
      await page.locator("[data-mostra-switch]").click();
      const v2 = page.frameLocator("iframe.mostra-frame");
      await expect(v2.getByTestId("version")).toHaveText("2", { timeout: 15_000 });
      await expect(v2.getByTestId("name")).toHaveValue("Ana offline");
      await expect(page.locator("[data-mostra-orphan=notes]")).toContainText(
        "a note for version 1",
      );
      await page.locator("#mostra-submit").click();
      await expect(page.locator("#mostra-submit")).toHaveText("Submitted");
      const done = (await results(client, own.artifactId)) as {
        answers: Record<string, unknown>;
        orphaned: { id: string; value: unknown; fromVersion: number }[];
      };
      expect(done.answers).toMatchObject({ name: "Ana offline" });
      expect(done.orphaned).toEqual([
        expect.objectContaining({ id: "notes", value: "a note for version 1", fromVersion: 1 }),
      ]);
    } finally {
      client.close();
    }
  });

  test("edits a closed tab left against version 1 replay as version 1's after version 2 is published (Claude review finding 12)", async ({
    browserName,
  }, info) => {
    test.setTimeout(150_000);
    // The tab closes with its edit unsent (Mostra is down), version 2 drops the field, and the
    // browser opens the artifact again at version 2: the journal it left is replayed as the view
    // it was made in, so the answer is version 1's, not carried over, never mapped to version 2.
    let daemon = await startDaemon();
    let client = await Client.connect(daemon.socket);
    const profile = mkdtempSync(join(tmpdir(), "mostra-e2e-profile-"));
    const stop = async (): Promise<void> => {
      client.close();
      daemon.child.kill("SIGTERM");
      await new Promise((resolve) => daemon.child.once("exit", resolve));
    };
    try {
      const own = await publishOwn(client, daemon.home, info);
      const url = await linkFor(client, own.artifactId, viewerName(info));
      const engine = { chromium, firefox, webkit }[browserName];
      const first = await engine.launchPersistentContext(profile);
      const page = first.pages()[0] ?? (await first.newPage());
      const frame = await openInShell(page, url);
      await expect(frame.getByTestId("version")).toHaveText("1");
      await stop();
      await frame.getByTestId("notes").fill("left by version 1");
      await frame.getByTestId("notes").blur();
      await expect(frame.getByTestId("notes-save")).toHaveText("offline");
      await first.close();
      daemon = await startDaemon({ root: daemon.root });
      client = await Client.connect(daemon.socket);
      await republish(client, own, (text) =>
        text.replace(
          'const [notes, setNotes, notesMeta] = useField("notes", "", { label: "Notes" });',
          'const [notes, setNotes] = useState(""); const notesMeta = { save: "saved" };',
        ),
      );
      const second = await engine.launchPersistentContext(profile);
      const next = second.pages()[0] ?? (await second.newPage());
      const again = await openInShell(next, url);
      await expect(again.getByTestId("version")).toHaveText("2");
      // The replayed answer is version 1's, shown as not carried over.
      await expect(next.locator("[data-mostra-orphan=notes]")).toContainText("left by version 1", {
        timeout: 15_000,
      });
      await again.getByTestId("name").fill("Ana");
      await saved(next);
      await next.locator("#mostra-submit").click();
      await expect(next.locator("#mostra-submit")).toHaveText("Submitted");
      const done = (await results(client, own.artifactId)) as {
        orphaned: { id: string; value: unknown; fromVersion: number }[];
      };
      expect(done.orphaned).toEqual([
        expect.objectContaining({ id: "notes", value: "left by version 1", fromVersion: 1 }),
      ]);
      await second.close();
    } finally {
      await stop();
      removeTree(daemon.root);
      rmSync(profile, { recursive: true, force: true });
    }
  });
});
